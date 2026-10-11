import { APP_NAME } from './app'

/** The page that runs YouTube's embedded player; the app shows it in a frame. */
export const YOUTUBE_PLAYER_PAGE = 'youtube-player.html'

export const YouTubePlayerChannel = {
  playerUrl: 'youtube:player-url'
} as const

/** The one thing the app window needs from the main process: where to load the player page from. */
export interface YouTubePlayerHostApi {
  getPlayerUrl(): Promise<string>
}

export type YouTubePlayerState = 'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued'

/** What the app asks the player page to do. A video is always started right after it is loaded. */
export type YouTubePlayerCommand =
  | { type: 'load'; videoId: string }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; seconds: number }
  /** 0 (silent) to 1 (full). */
  | { type: 'setVolume'; volume: number }

/** What the player page reports back, in plain terms (not YouTube's numeric codes). */
export type YouTubePlayerEvent =
  | { type: 'ready' }
  | { type: 'state'; videoId: string | null; state: YouTubePlayerState; positionSeconds: number; durationSeconds: number }
  /** YouTube's own error code, see `describeYouTubeError`. */
  | { type: 'error'; code: number }
  /** YouTube's player script could not be loaded at all. */
  | { type: 'load-failed' }

/** Video ids are 11 characters of URL-safe base64. */
export const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

const PLAYER_STATES: readonly string[] = ['unstarted', 'ended', 'playing', 'paused', 'buffering', 'cued']

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isNonNegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/** The page is YouTube's code in a frame, so everything it sends is checked before the app acts on it. */
export function isYouTubePlayerEvent(value: unknown): value is YouTubePlayerEvent {
  if (!isRecord(value)) return false
  switch (value.type) {
    case 'ready':
    case 'load-failed':
      return true
    case 'state':
      return (
        (value.videoId === null || (typeof value.videoId === 'string' && YOUTUBE_VIDEO_ID.test(value.videoId))) &&
        typeof value.state === 'string' &&
        PLAYER_STATES.includes(value.state) &&
        isNonNegative(value.positionSeconds) &&
        isNonNegative(value.durationSeconds)
      )
    case 'error':
      return typeof value.code === 'number' && Number.isInteger(value.code)
    default:
      return false
  }
}

/** The page accepts commands from its parent only, and only well-formed ones. */
export function isYouTubePlayerCommand(value: unknown): value is YouTubePlayerCommand {
  if (!isRecord(value)) return false
  switch (value.type) {
    case 'load':
      return typeof value.videoId === 'string' && YOUTUBE_VIDEO_ID.test(value.videoId)
    case 'play':
    case 'pause':
      return true
    case 'seek':
      return isNonNegative(value.seconds)
    case 'setVolume':
      return typeof value.volume === 'number' && value.volume >= 0 && value.volume <= 1
    default:
      return false
  }
}

/** What to tell the user for each error code the embedded player documents. */
export function describeYouTubeError(code: number): string {
  switch (code) {
    case 2:
      return "YouTube couldn't play this video (invalid request)."
    case 5:
      return "YouTube's player ran into a problem playing this video. Try again."
    case 100:
      return 'This video was removed or is private on YouTube.'
    case 101:
    case 150:
      return "The owner of this video doesn't allow it to be played outside YouTube."
    case 153:
      return `YouTube refused to play inside ${APP_NAME} (the player couldn't be verified).`
    default:
      return `YouTube couldn't play this video (error ${code}).`
  }
}
