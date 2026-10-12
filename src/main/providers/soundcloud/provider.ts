import type { Track, TrackPage } from '@shared/types'
import { AuthRequiredError, type OAuthSession } from '../../auth/session'
import { SOUNDCLOUD } from '../descriptors'
import type { MusicProvider } from '../types'
import { SOUNDCLOUD_API } from './config'

const API_HOST = new URL(SOUNDCLOUD_API).host
/** The most this endpoint returns in one page is 200; fifty keeps a page quick. */
const PAGE_SIZE = 50
const MAX_ERROR_MESSAGE_LENGTH = 200
/** Cursors come back from the renderer, so only accept what SoundCloud issues (letters, digits and URL-safe punctuation). */
const CURSOR_PATTERN = /^[A-Za-z0-9_\-.:~+/=,]{1,300}$/
/** A track's URN: `soundcloud:tracks:<number>`. */
const TRACK_URN = /^soundcloud:tracks:\d{1,20}$/

interface ScUser {
  username?: string
  avatar_url?: string | null
}

interface ScTrack {
  urn?: string
  id?: number | string
  title?: string
  duration?: number
  artwork_url?: string | null
  permalink_url?: string
  access?: string
  metadata_artist?: string | null
  user?: ScUser | null
}

interface TrackCollection {
  collection?: (ScTrack | null)[]
  next_href?: string | null
}

interface ErrorBody {
  message?: unknown
  error?: unknown
  errors?: { error_message?: unknown; meta?: { reset_time?: unknown } }[]
}

export type FetchFn = typeof fetch

export interface SoundCloudProviderOptions {
  fetch?: FetchFn
}

/** The `soundcloud:tracks:<id>` URN of a track, however the API spelled it. */
function trackUrn(track: ScTrack): string | undefined {
  if (typeof track.urn === 'string' && TRACK_URN.test(track.urn)) return track.urn
  const id = String(track.id ?? '')
  return /^\d{1,20}$/.test(id) ? `soundcloud:tracks:${id}` : undefined
}

/** The default artwork is a small square; the larger one of the same picture is sharp in the library. */
function artworkUrl(track: ScTrack): string | undefined {
  const url = track.artwork_url ?? track.user?.avatar_url
  if (typeof url !== 'string' || !url.startsWith('https://')) return undefined
  return url.replace(/-(?:large|small|tiny|badge|t\d+x\d+)(\.\w+)(\?.*)?$/, '-t300x300$1$2')
}

/** Only links that really point at SoundCloud are passed on to the UI. */
function soundcloudWebUrl(url: string | undefined): string | undefined {
  return url?.startsWith('https://soundcloud.com/') ? url : undefined
}

export function toTrack(track: ScTrack | null): Track | undefined {
  if (!track) return undefined
  const id = trackUrn(track)
  if (!id || !track.title) return undefined
  const artist = track.metadata_artist || track.user?.username
  return {
    id,
    providerId: 'soundcloud',
    title: track.title,
    artists: artist ? [artist] : [],
    durationMs: typeof track.duration === 'number' && track.duration > 0 ? track.duration : 0,
    artworkUrl: artworkUrl(track),
    url: soundcloudWebUrl(track.permalink_url),
    // Only fully streamable tracks can be played; the rest are previews, or blocked for this account or country.
    ...(track.access !== undefined && track.access !== 'playable' ? { playable: false } : {})
  }
}

/** The cursor in SoundCloud's `next_href`, if the link really points at SoundCloud's API. */
export function cursorFromNextHref(href: string | null | undefined): string | undefined {
  if (!href) return undefined
  try {
    const url = new URL(href)
    if (url.protocol !== 'https:' || url.host !== API_HOST) return undefined
    const cursor = url.searchParams.get('cursor')
    return cursor && CURSOR_PATTERN.test(cursor) ? cursor : undefined
  } catch {
    return undefined
  }
}

/** Turns a failed response into an error carrying SoundCloud's own explanation when it gave one. */
async function toApiError(response: Response): Promise<Error> {
  const fallback = `SoundCloud request failed with status ${response.status}`
  try {
    const body = (await response.json()) as ErrorBody
    if (response.status === 429) {
      const reset = body.errors?.map((entry) => entry.meta?.reset_time).find((value): value is string => typeof value === 'string')
      return new Error(
        `SoundCloud is limiting requests from this app.${reset ? ` Try again after ${reset.replace(/[^\d/: A-Za-z+-]/g, '').slice(0, 40)}.` : ' Try again later.'}`
      )
    }
    const message = [body.message, body.errors?.[0]?.error_message, body.error].find((value): value is string => typeof value === 'string' && value.trim() !== '')
    if (!message) return new Error(fallback)
    // The text is shown to the user, so drop control characters and cap the length.
    const clean = message.replace(/\p{Cc}/gu, ' ').trim().slice(0, MAX_ERROR_MESSAGE_LENGTH)
    return new Error(`SoundCloud: ${clean} (status ${response.status})`)
  } catch {
    return response.status === 429 ? new Error('SoundCloud is limiting requests from this app. Try again later.') : new Error(fallback)
  }
}

export function createSoundCloudProvider(session: OAuthSession, options: SoundCloudProviderOptions = {}): MusicProvider {
  const { fetch: fetchFn = fetch } = options

  /** Calls the API; a 401 gets one retry with a freshly refreshed token, then the user must sign in again. */
  async function request(path: string, method = 'GET'): Promise<Response> {
    let refreshed = false
    for (;;) {
      // Only the retry after a 401 forces a refresh.
      const token = await session.getAccessToken({ forceRefresh: refreshed })
      const response = await fetchFn(`${SOUNDCLOUD_API}${path}`, { method, headers: { Authorization: `OAuth ${token}`, Accept: 'application/json' } })

      if (response.status === 401) {
        if (refreshed) {
          // A just-refreshed token was still rejected, so the grant is no longer valid.
          await session.disconnect()
          throw new AuthRequiredError(SOUNDCLOUD.name)
        }
        refreshed = true
        continue
      }
      if (!response.ok) throw await toApiError(response)
      return response
    }
  }

  const getJson = async <T>(path: string): Promise<T> => (await request(path)).json() as Promise<T>

  return {
    info: SOUNDCLOUD,
    isConnected: () => session.isConnected(),
    connect: () => session.connect(),

    async disconnect() {
      // Revoking this app's tokens on SoundCloud's side (POST /disconnect, which leaves the user's own sign-in to
      // soundcloud.com alone) is good manners, but it must never stop the user disconnecting.
      try {
        const token = await session.getAccessToken()
        await fetchFn(`${SOUNDCLOUD_API}/disconnect`, { method: 'POST', headers: { Authorization: `OAuth ${token}` } })
      } catch {
        // Offline, or the token had already lapsed: the local sign-out below is what counts.
      }
      await session.disconnect()
    },

    async getSavedTracks(cursor): Promise<TrackPage> {
      if (cursor !== undefined && !CURSOR_PATTERN.test(cursor)) throw new Error('Invalid library cursor')
      const query = new URLSearchParams({ limit: String(PAGE_SIZE), linked_partitioning: 'true' })
      if (cursor !== undefined) query.set('cursor', cursor)

      const page = await getJson<TrackCollection>(`/me/likes/tracks?${query.toString()}`)
      const tracks = (page.collection ?? []).flatMap((item) => toTrack(item) ?? [])
      // A page can be empty after dropping unusable items, so the cursor follows SoundCloud's link, not the count.
      return { tracks, nextCursor: cursorFromNextHref(page.next_href) }
    }
  }
}
