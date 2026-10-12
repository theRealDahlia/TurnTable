import { APP_NAME } from './app'

/** The page that runs SoundCloud's widget player; the app shows it in a frame. */
export const SOUNDCLOUD_PLAYER_PAGE = 'soundcloud-player.html'

export const SoundCloudPlayerChannel = {
  playerUrl: 'soundcloud:player-url'
} as const

/** The one thing the app window needs from the main process: where to load the player page from. */
export interface SoundCloudPlayerHostApi {
  getPlayerUrl(): Promise<string>
}

export type SoundCloudPlayerState = 'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued'

/** What the app asks the player page to do. A track is always started right after it is loaded. */
export type SoundCloudPlayerCommand =
  | { type: 'load'; trackId: string }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; seconds: number }
  /** 0 (silent) to 1 (full). */
  | { type: 'setVolume'; volume: number }

/** What the player page reports back. */
export type SoundCloudPlayerEvent =
  | { type: 'ready' }
  | { type: 'state'; trackId: string | null; state: SoundCloudPlayerState; positionSeconds: number; durationSeconds: number }
  /** The widget reported an error; it gives no reason, so the code is always 0. */
  | { type: 'error'; code: number }
  /** SoundCloud's widget script could not be loaded at all. */
  | { type: 'load-failed' }

/** The numeric id of a track, the last part of its `soundcloud:tracks:<id>` URN. */
export const SOUNDCLOUD_TRACK_ID = /^\d{1,20}$/

const PLAYER_STATES: readonly string[] = ['unstarted', 'ended', 'playing', 'paused', 'buffering', 'cued']

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isNonNegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/** The page is SoundCloud's code in a frame, so everything it sends is checked before the app acts on it. */
export function isSoundCloudPlayerEvent(value: unknown): value is SoundCloudPlayerEvent {
  if (!isRecord(value)) return false
  switch (value.type) {
    case 'ready':
    case 'load-failed':
      return true
    case 'state':
      return (
        (value.trackId === null || (typeof value.trackId === 'string' && SOUNDCLOUD_TRACK_ID.test(value.trackId))) &&
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
export function isSoundCloudPlayerCommand(value: unknown): value is SoundCloudPlayerCommand {
  if (!isRecord(value)) return false
  switch (value.type) {
    case 'load':
      return typeof value.trackId === 'string' && SOUNDCLOUD_TRACK_ID.test(value.trackId)
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

/** What to tell the user when SoundCloud's player fails. */
export function describeSoundCloudError(code: number): string {
  void code
  return `SoundCloud couldn't play this track in ${APP_NAME}. Its uploader may not allow it to be played outside SoundCloud.`
}

/** The widget's address for a track, with everything but the player switched off. */
export function soundcloudWidgetUrl(trackId: string): string {
  const options = new URLSearchParams({
    url: `https://api.soundcloud.com/tracks/${trackId}`,
    auto_play: 'true',
    visual: 'true',
    show_comments: 'false',
    show_teaser: 'false',
    hide_related: 'true',
    buying: 'false',
    sharing: 'false',
    download: 'false',
    liking: 'false'
  })
  return `https://w.soundcloud.com/player/?${options.toString()}`
}
