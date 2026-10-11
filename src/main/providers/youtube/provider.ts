import type { Track, TrackPage } from '@shared/types'
import { AuthRequiredError, type OAuthSession } from '../../auth/session'
import { YOUTUBE_MUSIC } from '../descriptors'
import type { MusicProvider } from '../types'
import { YOUTUBE_SCOPES } from './config'
import { APP_NAME } from '@shared/app'

const API_BASE = 'https://www.googleapis.com/youtube/v3'
/** The most `videos.list` returns in one page. */
const PAGE_SIZE = 50
/** YouTube's category for music; the account's likes also include talks, gameplay and so on. */
const MUSIC_CATEGORY_ID = '10'
/** Only the fields the library shows, so each page stays small. */
const FIELDS = 'nextPageToken,items(id,snippet(title,channelTitle,categoryId,thumbnails),contentDetails(duration),status(embeddable))'
/** Artwork at least this wide looks sharp in the library without downloading the largest frame. */
const PREFERRED_ARTWORK_WIDTH = 300
const MAX_ERROR_MESSAGE_LENGTH = 200
const MAX_QUERY_LENGTH = 200
/**
 * Candidates per search page. Only the songs YouTube Music lists are kept, which is a minority of what a
 * search returns, and a page of any size costs the same quota, so ask for the most.
 */
const SEARCH_PAGE_SIZE = 50

/** Page tokens are opaque and come back from the renderer, so only accept what Google issues (URL-safe base64). */
const PAGE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,200}$/
/** Video ids are 11 characters of URL-safe base64. */
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/

/** Reasons Google gives when the project's request allowance is used up; it resets daily, so retrying now is pointless. */
const QUOTA_REASONS = new Set(['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded'])

interface Thumbnail {
  url?: string
  width?: number
}

interface YouTubeVideo {
  id?: string
  snippet?: {
    title?: string
    channelTitle?: string
    categoryId?: string
    thumbnails?: Record<string, Thumbnail | undefined>
  }
  contentDetails?: { duration?: string }
  status?: { embeddable?: boolean }
}

interface LikedVideosResponse {
  items?: YouTubeVideo[]
  nextPageToken?: string
}

interface GoogleErrorBody {
  error?: { message?: unknown; errors?: { reason?: unknown }[] }
}

export type FetchFn = typeof fetch

export interface YouTubeProviderOptions {
  fetch?: FetchFn
}

interface SearchResponse {
  items?: { id?: { videoId?: string }; snippet?: { channelTitle?: string } }[]
  nextPageToken?: string
}

interface RatingResponse {
  items?: { videoId?: string; rating?: string }[]
}

/** The user signed in with the older, read-only permission, which can't like videos. */
export class RatingPermissionError extends Error {
  constructor() {
    super(`Reconnect YouTube Music to allow saving songs in ${APP_NAME}.`)
    this.name = 'RatingPermissionError'
  }
}

/** An ISO 8601 duration such as `PT3M45S` or `PT1H2M3S`, in milliseconds; 0 for anything else (live streams are `P0D`). */
export function parseIsoDuration(value: string | undefined): number {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value ?? '')
  if (!match) return 0
  const [days, hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0))
  return (((days ?? 0) * 24 + (hours ?? 0)) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0)) * 1000
}

const TOPIC_SUFFIX = /\s+-\s+Topic$/i

/**
 * YouTube Music's songs are the audio tracks YouTube generates for each artist, on channels named
 * "<Artist> - Topic". The API has no way to search YouTube Music itself, so this is what tells a song
 * from a fan upload, a live recording or a regular video.
 */
export function isTopicChannel(channelTitle: string | undefined): boolean {
  return TOPIC_SUFFIX.test(channelTitle?.trim() ?? '')
}

/** Auto-generated artist channels are named "<Artist> - Topic"; show just the artist. */
export function artistFromChannel(channelTitle: string | undefined): string[] {
  const name = channelTitle?.replace(TOPIC_SUFFIX, '').trim()
  return name ? [name] : []
}

/** The smallest thumbnail that is still sharp enough, else the largest available. */
function pickArtwork(thumbnails: Record<string, Thumbnail | undefined> = {}): string | undefined {
  const usable = Object.values(thumbnails)
    .filter((thumbnail): thumbnail is Thumbnail & { url: string } => typeof thumbnail?.url === 'string' && thumbnail.url.startsWith('https://'))
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
  return (usable.find((thumbnail) => (thumbnail.width ?? 0) >= PREFERRED_ARTWORK_WIDTH) ?? usable.at(-1))?.url
}

function toTrack(video: YouTubeVideo): Track | undefined {
  const { id, snippet } = video
  // Likes can include things that aren't music, and removed videos come back without details.
  if (!id || !VIDEO_ID_PATTERN.test(id) || !snippet?.title || snippet.categoryId !== MUSIC_CATEGORY_ID) return undefined
  const durationMs = parseIsoDuration(video.contentDetails?.duration)
  if (durationMs === 0) return undefined
  return {
    id,
    providerId: 'youtubeMusic',
    title: snippet.title,
    artists: artistFromChannel(snippet.channelTitle),
    durationMs,
    artworkUrl: pickArtwork(snippet.thumbnails),
    url: `https://music.youtube.com/watch?v=${id}`,
    // Owners can switch off embedding, and the app can only play YouTube through the embedded player.
    ...(video.status?.embeddable === false ? { playable: false } : {})
    // YouTube does not say when a video was liked, so there is no save date.
  }
}

/** Turns a failed response into an error carrying Google's own explanation when it gave one. */
async function toApiError(response: Response): Promise<Error> {
  const fallback = `YouTube request failed with status ${response.status}`
  try {
    const { error } = (await response.json()) as GoogleErrorBody
    const reasons = (error?.errors ?? []).map((entry) => entry.reason)
    if (reasons.includes('videoRatingDisabled')) return new Error("The owner of this video has turned off likes, so it can't be saved.")
    if (reasons.some((reason) => typeof reason === 'string' && QUOTA_REASONS.has(reason))) {
      return new Error(`YouTube's daily request allowance for ${APP_NAME} is used up. It resets at midnight Pacific time; try again then.`)
    }
    if (typeof error?.message !== 'string') return new Error(fallback)
    // The text is shown to the user, so drop control characters and cap the length.
    const clean = error.message.replace(/\p{Cc}/gu, ' ').trim().slice(0, MAX_ERROR_MESSAGE_LENGTH)
    return new Error(clean ? `YouTube: ${clean} (status ${response.status})` : fallback)
  } catch {
    return new Error(fallback)
  }
}

export function createYouTubeProvider(session: OAuthSession, options: YouTubeProviderOptions = {}): MusicProvider {
  const { fetch: fetchFn = fetch } = options

  /** Calls the Data API; a 401 gets one retry with a freshly refreshed token, then the user must sign in again. */
  async function request(path: string, method = 'GET'): Promise<Response> {
    let refreshed = false
    for (;;) {
      // Only the retry after a 401 forces a refresh.
      const token = await session.getAccessToken({ forceRefresh: refreshed })
      const response = await fetchFn(`${API_BASE}${path}`, { method, headers: { Authorization: `Bearer ${token}` } })

      if (response.status === 401) {
        if (refreshed) {
          // A just-refreshed token was still rejected, so the grant is no longer valid.
          await session.disconnect()
          throw new AuthRequiredError(YOUTUBE_MUSIC.name)
        }
        refreshed = true
        continue
      }
      if (!response.ok) throw await toApiError(response)
      return response
    }
  }

  const getJson = async <T>(path: string): Promise<T> => (await request(path)).json() as Promise<T>

  /** Likes or un-likes a video, which is how YouTube Music "saves" a song. */
  async function rate(videoId: string, rating: 'like' | 'none'): Promise<void> {
    if (!VIDEO_ID_PATTERN.test(videoId)) throw new Error('That is not a valid YouTube video.')
    if (!(await session.hasScopes(YOUTUBE_SCOPES))) throw new RatingPermissionError()
    await request(`/videos/rate?${new URLSearchParams({ id: videoId, rating }).toString()}`, 'POST')
  }

  return {
    info: YOUTUBE_MUSIC,
    isConnected: () => session.isConnected(),
    connect: () => session.connect(),
    disconnect: () => session.disconnect(),

    async needsReauthorization() {
      return (await session.isConnected()) && !(await session.hasScopes(YOUTUBE_SCOPES))
    },

    async search(query, cursor): Promise<TrackPage> {
      const text = query.trim()
      if (!text || text.length > MAX_QUERY_LENGTH) throw new Error('Type something to search for.')
      if (cursor !== undefined && !PAGE_TOKEN_PATTERN.test(cursor)) throw new Error('Invalid library cursor')

      // Only embeddable music: those are the ones the app can play.
      const search = new URLSearchParams({
        part: 'snippet',
        type: 'video',
        videoCategoryId: MUSIC_CATEGORY_ID,
        videoEmbeddable: 'true',
        q: text,
        maxResults: String(SEARCH_PAGE_SIZE),
        fields: 'nextPageToken,items(id(videoId),snippet(channelTitle))'
      })
      if (cursor !== undefined) search.set('pageToken', cursor)
      const page = await getJson<SearchResponse>(`/search?${search.toString()}`)

      // Keep only what YouTube Music lists as songs, before spending quota on their details.
      const ids = (page.items ?? []).flatMap((item) =>
        item.id?.videoId && VIDEO_ID_PATTERN.test(item.id.videoId) && isTopicChannel(item.snippet?.channelTitle) ? [item.id.videoId] : []
      )
      if (ids.length === 0) return { tracks: [], nextCursor: page.nextPageToken }

      // A search only names the videos, so one request fetches their details and another says which are liked.
      const joined = ids.join(',')
      const details = new URLSearchParams({ part: 'snippet,contentDetails,status', id: joined, fields: FIELDS })
      const [videos, ratings] = await Promise.all([
        getJson<LikedVideosResponse>(`/videos?${details.toString()}`),
        getJson<RatingResponse>(`/videos/getRating?${new URLSearchParams({ id: joined }).toString()}`)
      ])

      const liked = new Set((ratings.items ?? []).filter((entry) => entry.rating === 'like').map((entry) => entry.videoId))
      const byId = new Map((videos.items ?? []).map((video) => [video.id, video]))
      // The details may come back in any order, so keep the order the search ranked them in.
      const tracks = ids.flatMap((id) => {
        const track = toTrack(byId.get(id) ?? {})
        return track ? [{ ...track, saved: liked.has(id) }] : []
      })
      return { tracks, nextCursor: page.nextPageToken }
    },

    saveTrack: (trackId) => rate(trackId, 'like'),
    unsaveTrack: (trackId) => rate(trackId, 'none'),

    async getSavedTracks(cursor): Promise<TrackPage> {
      if (cursor !== undefined && !PAGE_TOKEN_PATTERN.test(cursor)) throw new Error('Invalid library cursor')
      const query = new URLSearchParams({ part: 'snippet,contentDetails,status', myRating: 'like', maxResults: String(PAGE_SIZE), fields: FIELDS })
      if (cursor !== undefined) query.set('pageToken', cursor)

      const page = await getJson<LikedVideosResponse>(`/videos?${query.toString()}`)
      const tracks = (page.items ?? []).flatMap((video) => toTrack(video) ?? [])
      // A page can be empty after dropping non-music, so the cursor must follow Google's token, not the track count.
      return { tracks, nextCursor: page.nextPageToken }
    }
  }
}
