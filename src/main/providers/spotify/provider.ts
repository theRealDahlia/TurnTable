import type { Album, AlbumPage, Track, TrackPage } from '@shared/types'
import { AuthRequiredError, type OAuthSession } from '../../auth/session'
import { parseOffsetCursor } from '../cursor'
import { SPOTIFY } from '../descriptors'
import { LIBRARY_WRITE_SCOPES, PLAYBACK_SCOPES, REQUIRED_SCOPES } from './config'
import { RateLimitGate } from './rateLimit'
import type { MusicProvider } from '../types'
import { APP_NAME } from '@shared/app'

const API_BASE = 'https://api.spotify.com/v1'
/** Spotify's maximum page size for saved tracks. */
const PAGE_SIZE = 50
/** Artwork at least this wide looks sharp in the library without downloading the 640px original. */
const PREFERRED_ARTWORK_WIDTH = 300
/**
 * Rate-limit handling: the first refusal stops every request until Retry-After has passed, with no retry in the
 * meantime. If Spotify gives no usable Retry-After, or keeps refusing straight after, the stop is at least this
 * long and doubles each time.
 */
const BASE_BACKOFF_MS = 5000

interface SpotifyImage {
  url: string
  width: number | null
}

interface SpotifyArtist {
  id?: string | null
  name: string
}

interface SpotifyTrack {
  id: string | null
  name: string
  duration_ms: number
  is_local?: boolean
  disc_number?: number
  track_number?: number
  artists: SpotifyArtist[]
  /** Missing from an album's own track list, whose tracks are all on that album. */
  album?: { id?: string | null; name: string; images?: SpotifyImage[] }
  external_urls?: { spotify?: string }
}

/** An album as an artist's discography lists it. */
interface SpotifyAlbum {
  id: string | null
  name: string
  album_type?: string
  total_tracks?: number
  release_date?: string
  images?: SpotifyImage[]
  artists?: SpotifyArtist[]
  external_urls?: { spotify?: string }
}

interface Paging<T> {
  items: (T | null)[]
  next: string | null
}

interface SavedTracksResponse {
  items: { added_at: string; track: SpotifyTrack | null }[]
  next: string | null
}

interface SearchResponse {
  tracks?: { items: (SpotifyTrack | null)[]; next: string | null }
}

/** Spotify's largest page of an artist's albums, and of an album's tracks. */
const ALBUMS_PAGE_SIZE = 10
const ALBUM_TRACKS_PAGE_SIZE = 50
/** The artist's own releases; "appears_on" (other artists' records they feature on) is left out. */
const ALBUM_GROUPS = 'album,single,compilation'

/** Spotify returns at most this many search results per request (and none beyond the thousandth). */
const SEARCH_PAGE_SIZE = 10
const SEARCH_MAX_OFFSET = 1000
const MAX_QUERY_LENGTH = 200

export type FetchFn = typeof fetch

export interface SpotifyProviderOptions {
  fetch?: FetchFn
  sleep?: (ms: number) => Promise<void>
  /** Source of jitter in [0, 1); injectable so tests are deterministic. */
  random?: () => number
  now?: () => number
  /** Remembers when Spotify said to stop; the app passes one that survives restarts. */
  gate?: RateLimitGate
  /**
   * The least time between two requests to Spotify, so a long list is fetched at a steady pace and never in a burst.
   * Callers that ask at once are put in a queue. 0 (the default) means no spacing.
   */
  minIntervalMs?: number
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

/** How long to stop after refusal number `attempt` in a row (0-based): the larger of Retry-After and exponential backoff. */
function rateLimitDelay(response: Response, attempt: number, random: () => number): number {
  const header = Number(response.headers.get('Retry-After'))
  const retryAfterMs = Number.isFinite(header) && header > 0 ? header * 1000 : 0
  const backoffMs = BASE_BACKOFF_MS * 2 ** Math.min(attempt, 10) + random() * 250
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

/** Spotify ids are 22 base-62 characters; ids reach this code from the renderer, so check before building a URL. */
const ID_PATTERN = /^[A-Za-z0-9]{22}$/

/** A Spotify id that is safe to keep and hand back later, or "" when there is none. */
const plainId = (id: string | null | undefined): string => (typeof id === 'string' && ID_PATTERN.test(id) ? id : '')

const positive = (value: number | undefined): number | undefined => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined)

function toTrack(savedAt: string | undefined, track: SpotifyTrack | null): Track | undefined {
  // Removed/unavailable tracks come back as null, and local files have no Spotify id to play.
  if (!track || !track.id || track.is_local) return undefined
  const albumId = plainId(track.album?.id)
  return {
    id: track.id,
    providerId: 'spotify',
    title: track.name,
    artists: track.artists.map((artist) => artist.name),
    artistIds: track.artists.map((artist) => plainId(artist.id)),
    album: track.album?.name,
    ...(albumId ? { albumId } : {}),
    discNumber: positive(track.disc_number),
    trackNumber: positive(track.track_number),
    durationMs: track.duration_ms,
    artworkUrl: pickArtwork(track.album?.images),
    url: spotifyWebUrl(track.external_urls?.spotify),
    savedAt
  }
}

const ALBUM_KINDS: Record<string, Album['kind']> = { album: 'album', single: 'single', compilation: 'compilation' }

function toAlbum(album: SpotifyAlbum | null): Album | undefined {
  const id = plainId(album?.id)
  if (!album || !id || !album.name) return undefined
  return {
    id,
    providerId: 'spotify',
    title: album.name,
    artists: (album.artists ?? []).map((artist) => artist.name),
    artistIds: (album.artists ?? []).map((artist) => plainId(artist.id)),
    artworkUrl: pickArtwork(album.images),
    releaseDate: typeof album.release_date === 'string' ? album.release_date : undefined,
    kind: album.album_type ? ALBUM_KINDS[album.album_type] : undefined,
    trackCount: positive(album.total_tracks),
    url: spotifyWebUrl(album.external_urls?.spotify)
  }
}

/** Device ids come back from the SDK; they are opaque, so only exclude what could alter the URL. */
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{10,100}$/

const trackUri = (id: string): string => `spotify:track:${id}`

export interface SpotifyProvider extends MusicProvider {
  /** Starts a track on the player-page device, via the Web API. */
  startPlayback(deviceId: string, trackId: string): Promise<void>
  /** An access token for the Web Playback SDK, or an error asking the user to reconnect if playback was never authorized. */
  getPlaybackToken(): Promise<string>
}

/** The user signed in before saving songs existed, so their grant doesn't cover it. */
export class LibraryPermissionError extends Error {
  constructor() {
    super(`Reconnect Spotify to allow saving songs in ${APP_NAME}.`)
    this.name = 'LibraryPermissionError'
  }
}

/** The user signed in before playback existed, so their grant doesn't cover it. */
export class PlaybackPermissionError extends Error {
  constructor() {
    super(`Reconnect Spotify to allow playback in ${APP_NAME}.`)
    this.name = 'PlaybackPermissionError'
  }
}

export function createSpotifyProvider(session: OAuthSession, options: SpotifyProviderOptions = {}): SpotifyProvider {
  const { fetch: fetchFn = fetch, sleep = defaultSleep, random = Math.random, now = Date.now } = options
  const gate = options.gate ?? new RateLimitGate({ now })
  const { minIntervalMs = 0 } = options
  /** The earliest time the next request may be sent. */
  let nextSlot = 0
  /** How many refusals in a row, so the stop gets longer each time Spotify refuses again straight after. */
  let refusals = 0

  /** Waits for this request's turn: each one is at least `minIntervalMs` after the one before, even when several are asked for at once. */
  async function waitForTurn(): Promise<void> {
    if (minIntervalMs <= 0) return
    const current = now()
    const start = Math.max(current, nextSlot)
    nextSlot = start + minIntervalMs
    if (start > current) await sleep(start - current)
  }

  /**
   * Calls the Web API and returns a successful response. A 401 triggers one retry with a freshly
   * refreshed token; a 429 stops all requests until Spotify's Retry-After has passed (see `rateLimitDelay`).
   */
  async function call(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
    let forceRefresh = false
    let refreshed = false
    const body = init.body === undefined ? undefined : JSON.stringify(init.body)

    for (;;) {
      await gate.check()
      const token = await session.getAccessToken({ forceRefresh })
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
      if (body !== undefined) headers['Content-Type'] = 'application/json'
      await waitForTurn()
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
        // Stop at the first refusal: remember it, so nothing calls Spotify again, from this request or any other, until it's over.
        throw await gate.block(rateLimitDelay(response, refusals++, random))
      }

      refusals = 0
      if (!response.ok) throw await toApiError(response)
      return response
    }
  }

  /** Adds a track to the user's library or removes it, with `/me/library`, which replaced the type-specific endpoints. */
  async function changeLibrary(method: 'PUT' | 'DELETE', trackId: string): Promise<void> {
    if (!ID_PATTERN.test(trackId)) throw new Error('That is not a valid Spotify track.')
    if (!(await session.hasScopes(LIBRARY_WRITE_SCOPES))) throw new LibraryPermissionError()
    await call(`/me/library?${new URLSearchParams({ uris: trackUri(trackId) }).toString()}`, { method })
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
      return (await session.isConnected()) && !(await session.hasScopes(REQUIRED_SCOPES))
    },

    async startPlayback(deviceId, trackId) {
      if (!ID_PATTERN.test(trackId)) throw new Error('That is not a valid Spotify track.')
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

    async search(query, cursor): Promise<TrackPage> {
      const text = query.trim()
      if (!text || text.length > MAX_QUERY_LENGTH) throw new Error('Type something to search for.')
      const offset = parseOffsetCursor(cursor)
      if (offset >= SEARCH_MAX_OFFSET) return { tracks: [] }

      const params = new URLSearchParams({ q: text, type: 'track', limit: String(SEARCH_PAGE_SIZE), offset: String(offset) })
      const { tracks: found } = await getJson<SearchResponse>(`/search?${params.toString()}`)
      const items = found?.items ?? []
      const matches = items.flatMap((item) => toTrack(undefined, item) ?? [])

      // One more request tells which of these are already in the library, so the Save buttons start right.
      let tracks = matches
      if (matches.length > 0) {
        const uris = matches.map((track) => trackUri(track.id)).join(',')
        const saved = await getJson<boolean[]>(`/me/library/contains?${new URLSearchParams({ uris }).toString()}`)
        tracks = matches.map((track, index) => ({ ...track, saved: saved[index] === true }))
      }

      const hasMore = found?.next != null && items.length > 0 && offset + items.length < SEARCH_MAX_OFFSET
      return { tracks, nextCursor: hasMore ? String(offset + items.length) : undefined }
    },

    async saveTrack(trackId) {
      await changeLibrary('PUT', trackId)
    },

    async unsaveTrack(trackId) {
      await changeLibrary('DELETE', trackId)
    },

    async getArtistAlbums(artistId, cursor): Promise<AlbumPage> {
      if (!ID_PATTERN.test(artistId)) throw new Error('That is not a valid Spotify artist.')
      const offset = parseOffsetCursor(cursor)
      const params = new URLSearchParams({ include_groups: ALBUM_GROUPS, limit: String(ALBUMS_PAGE_SIZE), offset: String(offset) })
      const page = await getJson<Paging<SpotifyAlbum>>(`/artists/${artistId}/albums?${params.toString()}`)
      const hasMore = page.next !== null && page.items.length > 0
      return { albums: page.items.flatMap((album) => toAlbum(album) ?? []), nextCursor: hasMore ? String(offset + page.items.length) : undefined }
    },

    async getAlbumTracks(albumId, cursor): Promise<TrackPage> {
      if (!ID_PATTERN.test(albumId)) throw new Error('That is not a valid Spotify album.')
      const offset = parseOffsetCursor(cursor)
      const params = new URLSearchParams({ limit: String(ALBUM_TRACKS_PAGE_SIZE), offset: String(offset) })
      const page = await getJson<Paging<SpotifyTrack>>(`/albums/${albumId}/tracks?${params.toString()}`)
      // An album's own track list leaves the album out of each track; every one of them is on this album.
      const tracks = page.items.flatMap((track) => toTrack(undefined, track) ?? []).map((track) => ({ ...track, albumId }))
      const hasMore = page.next !== null && page.items.length > 0
      return { tracks, nextCursor: hasMore ? String(offset + page.items.length) : undefined }
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
