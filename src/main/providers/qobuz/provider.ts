import type { Credentials } from '@shared/ipc'
import type { AudioQuality, Track, TrackPage } from '@shared/types'
import { parseOffsetCursor } from '../cursor'
import { QOBUZ } from '../descriptors'
import type { MusicProvider } from '../types'
import { QOBUZ_API, type QobuzApp } from './config'
import type { QobuzSession, QobuzTier } from './session'

const PAGE_SIZE = 50
const SEARCH_PAGE_SIZE = 20
const MAX_QUERY_LENGTH = 200
const MAX_ERROR_MESSAGE_LENGTH = 200
/** A Qobuz track id is a plain number. */
const TRACK_ID = /^\d{1,12}$/
/** The most favorite ids one request returns. */
const MAX_FAVORITE_IDS = 5000

interface QobuzImage {
  large?: string | null
  small?: string | null
  thumbnail?: string | null
}

interface QobuzTrack {
  id?: number | string
  title?: string
  version?: string | null
  duration?: number
  streamable?: boolean
  maximum_bit_depth?: number
  maximum_sampling_rate?: number
  performer?: { name?: string } | null
  album?: { title?: string; image?: QobuzImage | null; artist?: { name?: string } | null } | null
  favorited_at?: number
}

interface TrackList {
  tracks?: { items?: (QobuzTrack | null)[]; total?: number; offset?: number }
}

interface FavoriteIds {
  tracks?: (number | string)[]
}

export type FetchFn = typeof fetch

export interface QobuzProviderOptions {
  fetch?: FetchFn
  app: () => QobuzApp
}

/** What a subscription can actually deliver of a track, which is at most what the track offers. */
export function qualityFor(track: QobuzTrack, tier: QobuzTier): AudioQuality | undefined {
  if (tier === 'none') return undefined
  if (tier === 'lossy') return { codec: 'mp3', lossless: false, bitrateKbps: 320 }
  const depth = track.maximum_bit_depth ?? 16
  const rate = (track.maximum_sampling_rate ?? 44.1) * 1000
  // Lossless subscriptions stop at CD quality; hi-res ones get what the track has.
  if (tier === 'lossless') return { codec: 'flac', lossless: true, bitDepth: Math.min(depth, 16), sampleRateHz: Math.min(rate, 44100) }
  return { codec: 'flac', lossless: true, bitDepth: depth, sampleRateHz: rate }
}

const https = (url: string | null | undefined): string | undefined => (typeof url === 'string' && url.startsWith('https://') ? url : undefined)

export function toTrack(track: QobuzTrack | null, tier: QobuzTier): Track | undefined {
  if (!track || !track.title) return undefined
  const id = String(track.id ?? '')
  if (!TRACK_ID.test(id)) return undefined
  const artist = track.performer?.name || track.album?.artist?.name
  const image = track.album?.image
  const added = typeof track.favorited_at === 'number' && track.favorited_at > 0 ? new Date(track.favorited_at * 1000).toISOString() : undefined
  return {
    id,
    providerId: 'qobuz',
    title: track.version ? `${track.title} (${track.version})` : track.title,
    artists: artist ? [artist] : [],
    album: track.album?.title,
    durationMs: typeof track.duration === 'number' && track.duration > 0 ? Math.round(track.duration * 1000) : 0,
    artworkUrl: https(image?.large) ?? https(image?.small) ?? https(image?.thumbnail),
    url: `https://open.qobuz.com/track/${id}`,
    quality: qualityFor(track, tier),
    savedAt: added,
    // An account without a subscription that streams can browse, but not play; some tracks are not streamable at all.
    ...(track.streamable === false || tier === 'none' ? { playable: false } : {})
  }
}

/** Turns a failed response into an error carrying Qobuz's own explanation when it gave one. */
async function toApiError(response: Response): Promise<Error> {
  const fallback = response.status === 429 ? 'Qobuz is limiting requests from this app. Try again later.' : `Qobuz request failed with status ${response.status}`
  try {
    const body = (await response.json()) as { message?: unknown }
    if (typeof body.message !== 'string' || !body.message.trim()) return new Error(fallback)
    // The text is shown to the user, so drop control characters and cap the length.
    return new Error(`Qobuz: ${body.message.replace(/\p{Cc}/gu, ' ').trim().slice(0, MAX_ERROR_MESSAGE_LENGTH)} (status ${response.status})`)
  } catch {
    return new Error(fallback)
  }
}

export function createQobuzProvider(session: QobuzSession, options: QobuzProviderOptions): MusicProvider {
  const { fetch: fetchFn = fetch } = options

  /** Calls the API with the user's token; a 401 means the token no longer works, so the user must sign in again. */
  async function request(path: string, params: Record<string, string> = {}): Promise<Response> {
    const token = await session.getToken()
    const url = `${QOBUZ_API}/${path}${Object.keys(params).length > 0 ? `?${new URLSearchParams(params).toString()}` : ''}`
    const response = await fetchFn(url, {
      headers: { 'X-App-Id': options.app().appId, 'X-User-Auth-Token': token, Accept: 'application/json' }
    })
    if (response.status === 401) return session.expire()
    if (!response.ok) throw await toApiError(response)
    return response
  }

  const getJson = async <T>(path: string, params?: Record<string, string>): Promise<T> => (await request(path, params)).json() as Promise<T>

  const favoriteIds = async (): Promise<Set<string>> => {
    const found = await getJson<FavoriteIds>('favorite/getUserFavoriteIds', { type: 'tracks', limit: String(MAX_FAVORITE_IDS) })
    return new Set((found.tracks ?? []).map(String))
  }

  async function changeFavorite(action: 'create' | 'delete', trackId: string): Promise<void> {
    // The id goes into the request, so it must be exactly a Qobuz track id.
    if (!TRACK_ID.test(trackId)) throw new Error('That is not a valid Qobuz track.')
    await request(`favorite/${action}`, { track_ids: trackId })
  }

  return {
    info: QOBUZ,
    isConnected: () => session.isConnected(),

    async connect(credentials?: Credentials) {
      if (!credentials) throw new Error('Enter your Qobuz email and password.')
      await session.signIn(credentials.username, credentials.password)
    },

    disconnect: () => session.signOut(),

    async getSavedTracks(cursor): Promise<TrackPage> {
      const offset = parseOffsetCursor(cursor)
      const [page, tier] = await Promise.all([
        getJson<TrackList>('favorite/getUserFavorites', { type: 'tracks', limit: String(PAGE_SIZE), offset: String(offset) }),
        session.tier()
      ])
      const items = page.tracks?.items ?? []
      const tracks = items.flatMap((item) => toTrack(item, tier) ?? [])
      // Advance by what Qobuz returned, and stop on an empty page so a bad total can't loop forever.
      const total = page.tracks?.total ?? 0
      return { tracks, nextCursor: items.length > 0 && offset + items.length < total ? String(offset + items.length) : undefined }
    },

    async search(query, cursor): Promise<TrackPage> {
      const text = query.trim()
      if (!text || text.length > MAX_QUERY_LENGTH) throw new Error('Type something to search for.')
      const offset = parseOffsetCursor(cursor)

      const [page, saved, tier] = await Promise.all([
        getJson<TrackList>('track/search', { query: text, limit: String(SEARCH_PAGE_SIZE), offset: String(offset) }),
        favoriteIds(),
        session.tier()
      ])
      const items = page.tracks?.items ?? []
      const tracks = items.flatMap((item) => {
        const track = toTrack(item, tier)
        return track ? [{ ...track, saved: saved.has(track.id) }] : []
      })
      const total = page.tracks?.total ?? 0
      return { tracks, nextCursor: items.length > 0 && offset + items.length < total ? String(offset + items.length) : undefined }
    },

    saveTrack: (trackId) => changeFavorite('create', trackId),
    unsaveTrack: (trackId) => changeFavorite('delete', trackId)
  }
}
