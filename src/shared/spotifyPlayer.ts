/** IPC channels. `page*` ones connect the hidden player page to the main process; the rest serve the app window. */
export const SpotifyPlayerChannel = {
  pageGetToken: 'spotify-player:get-token',
  pageEvent: 'spotify-player:event',
  pageCommand: 'spotify-player:command',
  play: 'spotify:play',
  pause: 'spotify:pause',
  resume: 'spotify:resume',
  seek: 'spotify:seek',
  setVolume: 'spotify:set-volume',
  event: 'spotify:event'
} as const

export type SpotifyErrorKind = 'initialization' | 'authentication' | 'account' | 'playback' | 'permission'

/** What the player reports, in plain terms the rest of the app understands. */
export type SpotifyPlayerEvent =
  | { type: 'ready'; deviceId: string }
  | { type: 'not-ready' }
  | {
      type: 'state'
      trackId: string | null
      /** When Spotify plays a regional variant of the requested track, the id that was requested. */
      linkedFromId?: string | null
      paused: boolean
      positionMs: number
      durationMs: number
      ended: boolean
    }
  | { type: 'error'; kind: SpotifyErrorKind; message: string }

/** What the main process can ask the player page to do. */
export type SpotifyPlayerCommand =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'seek'; positionMs: number }
  | { type: 'setVolume'; volume: number }

/** What the app window may do with Spotify playback. */
export interface SpotifyPlayerApi {
  play(trackId: string): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  seek(positionMs: number): Promise<void>
  setVolume(volume: number): Promise<void>
  /** Subscribes to player events; returns an unsubscribe function. */
  onEvent(listener: (event: SpotifyPlayerEvent) => void): () => void
}

/** The narrow bridge the hidden player page gets: nothing but its token, its events and its commands. */
export interface PlayerPageBridge {
  getToken(): Promise<string>
  emit(event: SpotifyPlayerEvent): void
  onCommand(listener: (command: SpotifyPlayerCommand) => void): void
}

export const SPOTIFY_ERRORS = {
  premium: 'Spotify Premium is required to play music in TurnTable.',
  initialization: "Spotify playback isn't available in this build of TurnTable (Widevine could not start).",
  authentication: 'Spotify rejected the sign-in. Reconnect Spotify and try again.',
  notReady: "Spotify's player did not start in time. Check your connection and try again.",
  loadFailed: "Couldn't load Spotify's player. Check your connection and try again."
} as const

const ERROR_KINDS: readonly string[] = ['initialization', 'authentication', 'account', 'playback', 'permission']
const MAX_MESSAGE_LENGTH = 500
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{10,100}$/

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isNonNegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/**
 * The player page runs Spotify's script, so nothing it sends is trusted: accept only well-formed events
 * of exactly the shapes defined above.
 */
export function isSpotifyPlayerEvent(value: unknown): value is SpotifyPlayerEvent {
  if (!isRecord(value)) return false
  switch (value.type) {
    case 'ready':
      return typeof value.deviceId === 'string' && DEVICE_ID_PATTERN.test(value.deviceId)
    case 'not-ready':
      return true
    case 'state':
      return (
        (value.trackId === null || typeof value.trackId === 'string') &&
        (value.linkedFromId === undefined || value.linkedFromId === null || typeof value.linkedFromId === 'string') &&
        typeof value.paused === 'boolean' &&
        isNonNegative(value.positionMs) &&
        isNonNegative(value.durationMs) &&
        typeof value.ended === 'boolean'
      )
    case 'error':
      return typeof value.kind === 'string' && ERROR_KINDS.includes(value.kind) && typeof value.message === 'string' && value.message.length <= MAX_MESSAGE_LENGTH
    default:
      return false
  }
}
