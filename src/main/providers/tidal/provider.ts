import type { TrackPage } from '@shared/types'
import { APP_NAME } from '@shared/app'
import { AuthRequiredError, type OAuthSession } from '../../auth/session'
import { TIDAL } from '../descriptors'
import { describeWait } from '../spotify/rateLimit'
import type { MusicProvider } from '../types'
import { COLLECTION_SCOPES, TIDAL_API, TIDAL_SCOPES } from './config'
import { Included, identifiers, nextCursorOf, toTrack, type Document } from './jsonapi'

const MAX_ERROR_MESSAGE_LENGTH = 200
/** Cursors come back from the renderer; TIDAL's are opaque, so only exclude what could break a URL or header. */
const CURSOR_PATTERN = /^\S{1,500}$/

/** The user signed in before the app asked for what it needs now, so their grant doesn't cover it. */
export class TidalPermissionError extends Error {
  constructor() {
    super(`Reconnect TIDAL to allow everything ${APP_NAME} needs.`)
    this.name = 'TidalPermissionError'
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

export interface TidalProviderOptions {
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

/** Turns a failed response into an error carrying TIDAL's own explanation (a JSON:API error object) when present. */
async function toApiError(response: Response): Promise<Error> {
  const fallback = `TIDAL request failed with status ${response.status}`
  try {
    const body = (await response.json()) as { errors?: { detail?: unknown; title?: unknown }[] }
    const first = body.errors?.[0]
    const message = typeof first?.detail === 'string' ? first.detail : typeof first?.title === 'string' ? first.title : undefined
    if (!message) return new Error(fallback)
    // The text is shown to the user, so drop control characters and cap the length.
    const clean = message.replace(/\p{Cc}/gu, ' ').trim().slice(0, MAX_ERROR_MESSAGE_LENGTH)
    return new Error(clean ? `TIDAL: ${clean} (status ${response.status})` : fallback)
  } catch {
    return new Error(fallback)
  }
}

export function createTidalProvider(session: OAuthSession, options: TidalProviderOptions = {}): MusicProvider {
  const { fetch: fetchFn = fetch, now = Date.now, minIntervalMs = 0 } = options
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  let nextSlot = 0
  let blockedUntil = 0
  /** Which of the library's `include` lists TIDAL accepted; once it refuses the long one, the short one is used. */
  let includeAttempt = 0

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
   */
  async function request(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
    let refreshed = false
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

      if (!response.ok) throw await toApiError(response)
      return response
    }
  }

  async function requireScopes(scopes: string[]): Promise<void> {
    if (!(await session.hasScopes(scopes))) throw new TidalPermissionError()
  }

  return {
    info: TIDAL,
    isConnected: () => session.isConnected(),
    connect: () => session.connect(),
    disconnect: () => session.disconnect(),

    async needsReauthorization() {
      return (await session.isConnected()) && !(await session.hasScopes(TIDAL_SCOPES))
    },

    async getSavedTracks(cursor): Promise<TrackPage> {
      if (cursor !== undefined && !CURSOR_PATTERN.test(cursor)) throw new Error('Invalid library cursor')
      await requireScopes(COLLECTION_SCOPES)

      for (;;) {
        const params = new URLSearchParams({ include: LIBRARY_INCLUDES[includeAttempt]!, sort: '-addedAt' })
        if (cursor !== undefined) params.set('page[cursor]', cursor)
        try {
          const document = (await (await request(`/userCollectionTracks/me/relationships/items?${params.toString()}`)).json()) as Document
          const included = new Included(document.included)
          const tracks = identifiers(document.data).flatMap((identifier) => toTrack(identifier, included) ?? [])
          // A page can be empty after dropping tracks that can't be shown, so the cursor follows TIDAL's own link.
          return { tracks, nextCursor: nextCursorOf(document) }
        } catch (error) {
          // TIDAL refused the long `include` list: use the short one from now on, and ask again.
          if (includeAttempt < LIBRARY_INCLUDES.length - 1 && error instanceof Error && /status 400\)$/.test(error.message)) {
            includeAttempt++
            continue
          }
          throw error
        }
      }
    }
  }
}
