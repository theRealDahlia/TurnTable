import type { Track, TrackPage } from '@shared/types'
import { AuthRequiredError, type OAuthSession } from '../../auth/session'
import { parseOffsetCursor } from '../cursor'
import { SPOTIFY } from '../descriptors'
import { PLAYBACK_SCOPES } from './config'
import { RateLimitGate } from './rateLimit'
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
  external_urls?: { spotify?: string }
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
  now?: () => number
  /** Remembers when Spotify said to stop; the app passes one that survives restarts. */
  gate?: RateLimitGate
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

/** Only links that really point at Spotify's web player are passed on to the UI. */
function spotifyWebUrl(url: string | undefined): string | undefined {
  return url?.startsWith('https://open.spotify.com/') ? url : undefined
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
    url: spotifyWebUrl(track.external_urls?.spotify),
    savedAt
  }
}

/** Spotify ids are 22 base-62 characters; ids reach this code from the renderer, so check before building a URL. */
const TRACK_ID_PATTERN = /^[A-Za-z0-9]{22}$/
/** Device ids come back from the SDK; they are opaque, so only exclude what could alter the URL. */
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{10,100}$/

export interface SpotifyProvider extends MusicProvider {
  /** Starts a track on the player-page device, via the Web API. */
  startPlayback(deviceId: string, trackId: string): Promise<void>
  /** An access token for the Web Playback SDK, or an error asking the user to reconnect if playback was never authorized. */
  getPlaybackToken(): Promise<string>
}

/** The user signed in before playback existed, so their grant doesn't cover it. */
export class PlaybackPermissionError extends Error {
  constructor() {
    super('Reconnect Spotify to allow playback in TurnTable.')
    this.name = 'PlaybackPermissionError'
  }
}

export function createSpotifyProvider(session: OAuthSession, options: SpotifyProviderOptions = {}): SpotifyProvider {
  const { fetch: fetchFn = fetch, sleep = defaultSleep, random = Math.random, now = Date.now } = options
  const gate = options.gate ?? new RateLimitGate({ now })

  /**
   * Calls the Web API and returns a successful response. A 401 triggers one retry with a freshly
   * refreshed token; a 429 waits as Spotify asks (with exponential backoff) and retries a few times.
   */
  async function call(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
    let forceRefresh = false
    let refreshed = false
    let rateLimitRetries = 0
    const body = init.body === undefined ? undefined : JSON.stringify(init.body)

    for (;;) {
      await gate.check()
      const token = await session.getAccessToken({ forceRefresh })
      forceRefresh = false
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      const response = await fetchFn(`${API_BASE}${path}`, { method: init.method, headers, body })

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
        // Too long to wait here, or Spotify keeps refusing: remember it, so nothing calls Spotify until it's over.
        if (rateLimitRetries >= MAX_RATE_LIMIT_RETRIES || delay > MAX_WAIT_MS) throw await gate.block(delay)
        rateLimitRetries++
        await sleep(delay)
        continue
      }

      if (!response.ok) throw await toApiError(response)
      return response
    }
  }

  async function getJson<T>(path: string): Promise<T> {
    return (await (await call(path)).json()) as T
  }

  return {
    info: SPOTIFY,
    isConnected: () => session.isConnected(),
    connect: () => session.connect(),
    disconnect: () => session.disconnect(),

    async needsReauthorization() {
      return (await session.isConnected()) && !(await session.hasScopes(PLAYBACK_SCOPES))
    },

    async startPlayback(deviceId, trackId) {
      if (!TRACK_ID_PATTERN.test(trackId)) throw new Error('That is not a valid Spotify track.')
      if (!DEVICE_ID_PATTERN.test(deviceId)) throw new Error('Spotify player is not ready.')
      await call(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
        method: 'PUT',
        body: { uris: [`spotify:track:${trackId}`], position_ms: 0 }
      })
    },

    async getPlaybackToken() {
      if (!(await session.hasScopes(PLAYBACK_SCOPES))) throw new PlaybackPermissionError()
      return session.getAccessToken()
    },

    async getSavedTracks(cursor): Promise<TrackPage> {
      const offset = parseOffsetCursor(cursor)
      const page = await getJson<SavedTracksResponse>(`/me/tracks?limit=${PAGE_SIZE}&offset=${offset}`)

      const tracks = page.items.flatMap((item) => toTrack(item.added_at, item.track) ?? [])
      // Advance by what Spotify returned, and stop on an empty page so a bad `next` can't loop forever.
      const hasMore = page.next !== null && page.items.length > 0
      return { tracks, nextCursor: hasMore ? String(offset + page.items.length) : undefined }
    }
  }
}
