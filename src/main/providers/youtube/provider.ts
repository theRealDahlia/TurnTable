import type { Track, TrackPage } from '@shared/types'
import { AuthRequiredError, type OAuthSession } from '../../auth/session'
import { YOUTUBE_MUSIC } from '../descriptors'
import type { MusicProvider } from '../types'

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

/** An ISO 8601 duration such as `PT3M45S` or `PT1H2M3S`, in milliseconds; 0 for anything else (live streams are `P0D`). */
export function parseIsoDuration(value: string | undefined): number {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value ?? '')
  if (!match) return 0
  const [days, hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0))
  return (((days ?? 0) * 24 + (hours ?? 0)) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0)) * 1000
}

/** Auto-generated artist channels are named "<Artist> - Topic"; show just the artist. */
export function artistFromChannel(channelTitle: string | undefined): string[] {
  const name = channelTitle?.replace(/\s+-\s+Topic$/i, '').trim()
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
    // Owners can switch off embedding, and TurnTable can only play YouTube through the embedded player.
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
    if (reasons.some((reason) => typeof reason === 'string' && QUOTA_REASONS.has(reason))) {
      return new Error("YouTube's daily request allowance for TurnTable is used up. It resets at midnight Pacific time; try again then.")
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
  async function getJson<T>(path: string): Promise<T> {
    let refreshed = false
    for (;;) {
      // Only the retry after a 401 forces a refresh.
      const token = await session.getAccessToken({ forceRefresh: refreshed })
      const response = await fetchFn(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } })

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
      return (await response.json()) as T
    }
  }

  return {
    info: YOUTUBE_MUSIC,
    isConnected: () => session.isConnected(),
    connect: () => session.connect(),
    disconnect: () => session.disconnect(),

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
