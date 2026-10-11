import type { Track, TrackPage } from '@shared/types'
import { AuthRequiredError, type OAuthSession } from '../../auth/session'
import { SPOTIFY } from '../descriptors'
import type { MusicProvider } from '../types'

const API_BASE = 'https://api.spotify.com/v1'
/** Spotify's maximum page size for saved tracks. */
const PAGE_SIZE = 50
/** Artwork at least this wide looks sharp in the library without downloading the 640px original. */
const PREFERRED_ARTWORK_WIDTH = 300
/** Rate-limit handling: wait at least Retry-After, backing off exponentially if Spotify keeps refusing. */
const MAX_RATE_LIMIT_RETRIES = 3
const BASE_BACKOFF_MS = 1000
/** Longer waits than this are reported to the user instead of silently stalling the library. */
const MAX_WAIT_MS = 30_000

interface SpotifyImage {
  url: string
  width: number | null
}

interface SpotifyTrack {
  id: string | null
  name: string
  duration_ms: number
  is_local?: boolean
  artists: { name: string }[]
  album?: { name: string; images?: SpotifyImage[] }
}

interface SavedTracksResponse {
  items: { added_at: string; track: SpotifyTrack | null }[]
  next: string | null
}

export type FetchFn = typeof fetch

export interface SpotifyProviderOptions {
  fetch?: FetchFn
  sleep?: (ms: number) => Promise<void>
  /** Source of jitter in [0, 1); injectable so tests are deterministic. */
  random?: () => number
}

const MAX_ERROR_MESSAGE_LENGTH = 200

/** Turns a failed response into an error carrying Spotify's own explanation (`{ error: { message } }`) when present. */
async function toApiError(response: Response): Promise<Error> {
  const fallback = `Spotify request failed with status ${response.status}`
  try {
    const body = (await response.json()) as { error?: { message?: unknown } }
    const message = body.error?.message
    if (typeof message !== 'string') return new Error(fallback)
    // The text is shown to the user, so drop control characters and cap the length.
    const clean = message.replace(/\p{Cc}/gu, ' ').trim().slice(0, MAX_ERROR_MESSAGE_LENGTH)
    return new Error(clean ? `Spotify: ${clean} (status ${response.status})` : fallback)
  } catch {
    return new Error(fallback)
  }
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** How long to wait before retry number `attempt` (0-based): the larger of Retry-After and exponential backoff. */
function rateLimitDelay(response: Response, attempt: number, random: () => number): number {
  const header = Number(response.headers.get('Retry-After'))
  const retryAfterMs = Number.isFinite(header) && header > 0 ? header * 1000 : 0
  const backoffMs = BASE_BACKOFF_MS * 2 ** attempt + random() * 250
  return Math.max(retryAfterMs, backoffMs)
}

/** The smallest image that is still sharp enough, else the largest available. */
function pickArtwork(images: SpotifyImage[] = []): string | undefined {
  const bySize = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
  return (bySize.find((image) => (image.width ?? 0) >= PREFERRED_ARTWORK_WIDTH) ?? bySize.at(-1))?.url
}

function toTrack(savedAt: string, track: SpotifyTrack | null): Track | undefined {
  // Removed/unavailable tracks come back as null, and local files have no Spotify id to play.
  if (!track || !track.id || track.is_local) return undefined
  return {
    id: track.id,
    providerId: 'spotify',
    title: track.name,
    artists: track.artists.map((artist) => artist.name),
    album: track.album?.name,
    durationMs: track.duration_ms,
    artworkUrl: pickArtwork(track.album?.images),
    savedAt
  }
}

/** Cursors come from the renderer, so only accept what this provider would have issued. */
function parseCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  if (!/^\d{1,9}$/.test(cursor)) throw new Error('Invalid library cursor')
  return Number(cursor)
}

export function createSpotifyProvider(session: OAuthSession, options: SpotifyProviderOptions = {}): MusicProvider {
  const { fetch: fetchFn = fetch, sleep = defaultSleep, random = Math.random } = options

  /**
   * Calls the Web API. A 401 triggers one retry with a freshly refreshed token; a 429 waits as Spotify
   * asks (with exponential backoff) and retries a few times before giving up.
   */
  async function request<T>(path: string): Promise<T> {
    let forceRefresh = false
    let refreshed = false
    let rateLimitRetries = 0

    for (;;) {
      const token = await session.getAccessToken({ forceRefresh })
      forceRefresh = false
      const response = await fetchFn(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } })

      if (response.status === 401) {
        if (refreshed) {
          // A just-refreshed token was still rejected, so the grant is no longer valid.
          await session.disconnect()
          throw new AuthRequiredError(SPOTIFY.name)
        }
        refreshed = true
        forceRefresh = true
        continue
      }

      if (response.status === 429) {
        const delay = rateLimitDelay(response, rateLimitRetries, random)
        if (rateLimitRetries >= MAX_RATE_LIMIT_RETRIES || delay > MAX_WAIT_MS) {
          throw new Error(`Spotify is rate limiting requests. Try again in ${Math.ceil(delay / 1000)}s.`)
        }
        rateLimitRetries++
        await sleep(delay)
        continue
      }

      if (!response.ok) throw await toApiError(response)
      return (await response.json()) as T
    }
  }

  return {
    info: SPOTIFY,
    isConnected: () => session.isConnected(),
    connect: () => session.connect(),
    disconnect: () => session.disconnect(),

    async getSavedTracks(cursor): Promise<TrackPage> {
      const offset = parseCursor(cursor)
      const page = await request<SavedTracksResponse>(`/me/tracks?limit=${PAGE_SIZE}&offset=${offset}`)

      const tracks = page.items.flatMap((item) => toTrack(item.added_at, item.track) ?? [])
      // Advance by what Spotify returned, and stop on an empty page so a bad `next` can't loop forever.
      const hasMore = page.next !== null && page.items.length > 0
      return { tracks, nextCursor: hasMore ? String(offset + page.items.length) : undefined }
    }
  }
}
