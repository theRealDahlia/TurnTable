import type { Track, TrackPage } from '@shared/types'
import { AuthRequiredError, type OAuthSession } from '../../auth/session'
import { SPOTIFY } from '../descriptors'
import type { MusicProvider } from '../types'

const API_BASE = 'https://api.spotify.com/v1'
/** Spotify's maximum page size for saved tracks. */
const PAGE_SIZE = 50
/** Artwork at least this wide looks sharp in the library without downloading the 640px original. */
const PREFERRED_ARTWORK_WIDTH = 300

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

export function createSpotifyProvider(session: OAuthSession, fetchFn: FetchFn = fetch): MusicProvider {
  /** Calls the Web API, retrying once with a freshly refreshed token if Spotify rejects the current one. */
  async function request<T>(path: string): Promise<T> {
    for (const forceRefresh of [false, true]) {
      const token = await session.getAccessToken({ forceRefresh })
      const response = await fetchFn(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } })

      if (response.status === 401) continue
      if (response.status === 429) {
        const wait = response.headers.get('Retry-After')
        throw new Error(`Spotify is rate limiting requests${wait ? `. Try again in ${wait}s` : ''}.`)
      }
      if (!response.ok) throw new Error(`Spotify request failed with status ${response.status}`)
      return (await response.json()) as T
    }

    // A just-refreshed token was still rejected, so the grant is no longer valid.
    await session.disconnect()
    throw new AuthRequiredError(SPOTIFY.name)
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
