import type { AlbumPage, Track, TrackPage } from '@shared/types'
import { APP_NAME } from '@shared/app'
import { AuthRequiredError, type OAuthSession } from '../../auth/session'
import { TIDAL } from '../descriptors'
import { describeWait } from '../spotify/rateLimit'
import type { MusicProvider } from '../types'
import { SERVER_ERROR_RETRY_DELAYS_MS, shouldRetryServerError } from '../serverErrors'
import type { TidalPlayerAuth } from '@shared/tidalPlayer'
import { COLLECTION_SCOPES, PLAYBACK_SCOPES, SEARCH_SCOPES, TIDAL_API, TIDAL_SCOPES } from './config'
import { ID_PATTERN, Included, identifiers, nextCursorOf, toAlbum, toTrack, type Document } from './jsonapi'

const MAX_ERROR_MESSAGE_LENGTH = 200
const MAX_QUERY_LENGTH = 200
/** Cursors come back from the renderer; TIDAL's are opaque, so only exclude what could break a URL or header. */
const CURSOR_PATTERN = /^\S{1,500}$/

/** The user signed in before the app asked for what it needs now, so their grant doesn't cover it. */
export class TidalPermissionError extends Error {
  constructor() {
    super(`Reconnect TIDAL to allow everything ${APP_NAME} needs.`)
    this.name = 'TidalPermissionError'
  }
}

/** TIDAL refused a request; `status` is its HTTP status, so callers can tell a conflict from an outage. */
export class TidalApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'TidalApiError'
  }
}

/** TIDAL has asked the app to stop for a while; nothing is sent to it until then. */
export class TidalRateLimitedError extends Error {
  constructor(
    readonly until: number,
    now: number
  ) {
    super(`TIDAL has temporarily limited ${APP_NAME}'s access (rate limit). Try again ${describeWait(until, now)}.`)
    this.name = 'TidalRateLimitedError'
  }
}

/** The user signed in before playback was added, so their grant doesn't cover it. */
export class TidalPlaybackPermissionError extends Error {
  constructor() {
    super(`Reconnect TIDAL to allow playback in ${APP_NAME}.`)
    this.name = 'TidalPlaybackPermissionError'
  }
}

export interface TidalProvider extends MusicProvider {
  /** What TIDAL's own player needs: this app's client ID and a current token, or an error asking the user to reconnect. */
  getPlaybackAuth(): Promise<TidalPlayerAuth>
}

export interface TidalProviderOptions {
  /** This app's client ID, which TIDAL's player sends along with every request. */
  clientId?: () => string | undefined
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** The least time between two requests, so a long library arrives at a steady pace and never in a burst. 0 means no spacing. */
  minIntervalMs?: number
}

/** Used when TIDAL says to wait but not for how long. */
const DEFAULT_BLOCK_MS = 30_000
/** Whatever TIDAL says, never stay blocked longer than this. */
const MAX_BLOCK_MS = 24 * 60 * 60 * 1000

/**
 * What a library page asks to have sent along: the tracks, then their artists, albums and cover art, so one request
 * is enough to show a page. If TIDAL turns that down, the shorter one still lists the tracks.
 */
const LIBRARY_INCLUDES = ['items,items.artists,items.albums,items.albums.coverArt', 'items']
/** The same for search results, whose tracks hang off the search result rather than off the user's collection. */
const SEARCH_INCLUDES = ['tracks,tracks.artists,tracks.albums,tracks.albums.coverArt', 'tracks']
/** An artist's albums with their cover art and artists; an album's tracks, like a library page. */
const ARTIST_ALBUM_INCLUDES = ['albums,albums.coverArt,albums.artists', 'albums']
const ALBUM_TRACK_INCLUDES = LIBRARY_INCLUDES

/**
 * Where a search is up to: which search result to continue, and TIDAL's cursor into its tracks. One string,
 * since that is all a page hands back to ask for the next.
 */
function encodeSearchCursor(id: string, cursor: string): string | undefined {
  const encoded = Buffer.from(JSON.stringify([id, cursor])).toString('base64url')
  // A cursor that would not survive the trip to the app and back is dropped, which ends the results here.
  return encoded.length <= 480 ? encoded : undefined
}

function decodeSearchCursor(encoded: string): { id: string; cursor: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (Array.isArray(parsed) && typeof parsed[0] === 'string' && typeof parsed[1] === 'string' && parsed[0] && CURSOR_PATTERN.test(parsed[1])) {
      return { id: parsed[0].slice(0, 300), cursor: parsed[1] }
    }
  } catch {
    // Falls through to the error below.
  }
  throw new Error('Invalid library cursor')
}

/** Turns a failed response into an error carrying TIDAL's own explanation (a JSON:API error object) when present. */
async function toApiError(response: Response): Promise<TidalApiError> {
  const fallback = new TidalApiError(`TIDAL request failed with status ${response.status}`, response.status)
  try {
    const body = (await response.json()) as { errors?: { detail?: unknown; title?: unknown }[] }
    const first = body.errors?.[0]
    const message = typeof first?.detail === 'string' ? first.detail : typeof first?.title === 'string' ? first.title : undefined
    if (!message) return fallback
    // The text is shown to the user, so drop control characters and cap the length.
    const clean = message.replace(/\p{Cc}/gu, ' ').trim().slice(0, MAX_ERROR_MESSAGE_LENGTH)
    return clean ? new TidalApiError(`TIDAL: ${clean} (status ${response.status})`, response.status) : fallback
  } catch {
    return fallback
  }
}

export function createTidalProvider(session: OAuthSession, options: TidalProviderOptions = {}): TidalProvider {
  const { fetch: fetchFn = fetch, now = Date.now, minIntervalMs = 0 } = options
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let nextSlot = 0
  let blockedUntil = 0
  /** Which `include` list TIDAL accepted for the library and for search; once it refuses the long one, the short one is used. */
  const includeAttempt = { library: 0, search: 0, artistAlbums: 0, albumTracks: 0 }

  async function waitForTurn(): Promise<void> {
    if (minIntervalMs <= 0) return
    const current = now()
    const start = Math.max(current, nextSlot)
    nextSlot = start + minIntervalMs
    if (start > current) await sleep(start - current)
  }

  /**
   * Calls TIDAL's API and returns a successful response. A 401 gets one retry with a freshly refreshed token, then
   * the user must sign in again. A 429 stops every request until the wait TIDAL asked for is over, with no retry.
   * A read that meets a passing server error (502 and the like) is asked again after a pause, twice at most.
   */
  async function request(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
    let refreshed = false
    let serverRetries = 0
    const body = init.body === undefined ? undefined : JSON.stringify(init.body)

    for (;;) {
      const current = now()
      if (current < blockedUntil) throw new TidalRateLimitedError(blockedUntil, current)

      const token = await session.getAccessToken({ forceRefresh: refreshed })
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.api+json' }
      if (body !== undefined) headers['Content-Type'] = 'application/vnd.api+json'
      await waitForTurn()
      const response = await fetchFn(`${TIDAL_API}${path}`, { method: init.method, headers, body })

      if (response.status === 401) {
        if (refreshed) {
          // A just-refreshed token was still rejected, so the grant is no longer valid.
          await session.disconnect()
          throw new AuthRequiredError(TIDAL.name)
        }
        refreshed = true
        continue
      }

      if (response.status === 429) {
        const seconds = Number(response.headers.get('Retry-After'))
        const wait = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_BLOCK_MS
        blockedUntil = now() + Math.min(wait, MAX_BLOCK_MS)
        throw new TidalRateLimitedError(blockedUntil, now())
      }

      if (shouldRetryServerError(init.method, response.status, serverRetries)) {
        await sleep(SERVER_ERROR_RETRY_DELAYS_MS[serverRetries++]!)
        continue
      }
      if (!response.ok) throw await toApiError(response)
      return response
    }
  }

  async function requireScopes(scopes: string[]): Promise<void> {
    if (!(await session.hasScopes(scopes))) throw new TidalPermissionError()
  }

  /** Runs `attempt` with the long `include` list, then with the short one if TIDAL refuses the long one (and keeps using it). */
  async function withIncludes<T>(kind: keyof typeof includeAttempt, lists: string[], attempt: (include: string) => Promise<T>): Promise<T> {
    for (;;) {
      try {
        return await attempt(lists[includeAttempt[kind]]!)
      } catch (error) {
        if (includeAttempt[kind] < lists.length - 1 && error instanceof TidalApiError && error.status === 400) {
          includeAttempt[kind]++
          continue
        }
        throw error
      }
    }
  }

  async function getDocument(path: string): Promise<Document> {
    return (await (await request(path)).json()) as Document
  }

  const tracksOf = (document: Document): Track[] => {
    const included = new Included(document.included)
    return identifiers(document.data).flatMap((identifier) => toTrack(identifier, included) ?? [])
  }

  /** Adds a track to the user's collection or removes it. Already being there (or already gone) is not a failure. */
  async function changeCollection(method: 'POST' | 'DELETE', trackId: string): Promise<void> {
    if (!ID_PATTERN.test(trackId)) throw new Error('That is not a valid TIDAL track.')
    await requireScopes(COLLECTION_SCOPES)
    try {
      await request('/userCollectionTracks/me/relationships/items', { method, body: { data: [{ id: trackId, type: 'tracks' }] } })
    } catch (error) {
      if (error instanceof TidalApiError && error.status === (method === 'POST' ? 409 : 404)) return
      throw error
    }
  }

  return {
    info: TIDAL,
    isConnected: () => session.isConnected(),
    connect: () => session.connect(),
    disconnect: () => session.disconnect(),

    async getPlaybackAuth() {
      const clientId = options.clientId?.()
      if (!clientId) throw new Error('TIDAL is not set up: add your TIDAL app\'s client ID to .env as MAIN_VITE_TIDAL_CLIENT_ID (see README).')
      if (!(await session.hasScopes(PLAYBACK_SCOPES))) throw new TidalPlaybackPermissionError()
      return { clientId, token: await session.getAccessToken() }
    },

    async needsReauthorization() {
      return (await session.isConnected()) && !(await session.hasScopes(TIDAL_SCOPES))
    },

    async getSavedTracks(cursor): Promise<TrackPage> {
      if (cursor !== undefined && !CURSOR_PATTERN.test(cursor)) throw new Error('Invalid library cursor')
      await requireScopes(COLLECTION_SCOPES)

      return withIncludes('library', LIBRARY_INCLUDES, async (include) => {
        const params = new URLSearchParams({ include, sort: '-addedAt' })
        if (cursor !== undefined) params.set('page[cursor]', cursor)
        const document = await getDocument(`/userCollectionTracks/me/relationships/items?${params.toString()}`)
        // A page can be empty after dropping tracks that can't be shown, so the cursor follows TIDAL's own link.
        return { tracks: tracksOf(document), nextCursor: nextCursorOf(document) }
      })
    },

    async search(query, cursor): Promise<TrackPage> {
      const text = query.trim()
      if (!text || text.length > MAX_QUERY_LENGTH) throw new Error('Type something to search for.')
      const position = cursor === undefined ? undefined : decodeSearchCursor(cursor)
      await requireScopes(SEARCH_SCOPES)

      return withIncludes('search', SEARCH_INCLUDES, async (include) => {
        // The first page comes from the search itself; the rest from the same search result's track list.
        if (position) {
          const params = new URLSearchParams({ include, 'page[cursor]': position.cursor, explicitFilter: 'INCLUDE' })
          const document = await getDocument(`/searchResults/${encodeURIComponent(position.id)}/relationships/tracks?${params.toString()}`)
          const next = nextCursorOf(document)
          return { tracks: tracksOf(document), nextCursor: next === undefined ? undefined : encodeSearchCursor(position.id, next) }
        }
        const params = new URLSearchParams({ 'filter[query]': text, include, explicitFilter: 'INCLUDE' })
        const document = await getDocument(`/searchResults?${params.toString()}`)
        const result = identifiers(document.data)[0] as { id?: unknown; relationships?: { tracks?: { data?: unknown; links?: Document['links'] } } } | undefined
        const tracksRelationship = result?.relationships?.tracks
        const included = new Included(document.included)
        const next = nextCursorOf({ links: tracksRelationship?.links })
        return {
          tracks: identifiers(tracksRelationship?.data).flatMap((identifier) => toTrack(identifier, included) ?? []),
          nextCursor: next !== undefined && typeof result?.id === 'string' ? encodeSearchCursor(result.id, next) : undefined
        }
      })
    },

    async getArtistAlbums(artistId, cursor): Promise<AlbumPage> {
      if (!ID_PATTERN.test(artistId)) throw new Error('That is not a valid TIDAL artist.')
      if (cursor !== undefined && !CURSOR_PATTERN.test(cursor)) throw new Error('Invalid library cursor')

      return withIncludes('artistAlbums', ARTIST_ALBUM_INCLUDES, async (include) => {
        const params = new URLSearchParams({ include })
        if (cursor !== undefined) params.set('page[cursor]', cursor)
        const document = await getDocument(`/artists/${artistId}/relationships/albums?${params.toString()}`)
        const included = new Included(document.included)
        return { albums: identifiers(document.data).flatMap((identifier) => toAlbum(identifier, included) ?? []), nextCursor: nextCursorOf(document) }
      })
    },

    async getAlbumTracks(albumId, cursor): Promise<TrackPage> {
      if (!ID_PATTERN.test(albumId)) throw new Error('That is not a valid TIDAL album.')
      if (cursor !== undefined && !CURSOR_PATTERN.test(cursor)) throw new Error('Invalid library cursor')

      return withIncludes('albumTracks', ALBUM_TRACK_INCLUDES, async (include) => {
        const params = new URLSearchParams({ include })
        if (cursor !== undefined) params.set('page[cursor]', cursor)
        const document = await getDocument(`/albums/${albumId}/relationships/items?${params.toString()}`)
        // An album's items can include videos, which have no track to show and are left out.
        return { tracks: tracksOf(document).map((track) => ({ ...track, albumId })), nextCursor: nextCursorOf(document) }
      })
    },

    async saveTrack(trackId) {
      await changeCollection('POST', trackId)
    },

    async unsaveTrack(trackId) {
      await changeCollection('DELETE', trackId)
    }
  }
}
