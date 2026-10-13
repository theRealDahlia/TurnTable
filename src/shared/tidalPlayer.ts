import { APP_NAME } from './app'
import { MEDIA_KEY_ACTIONS, type MediaKeyAction } from './spotifyPlayer'

/** IPC channels. `page*` ones connect the hidden player page to the main process; the rest serve the app window. */
export const TidalPlayerChannel = {
  pageGetAuth: 'tidal-player:get-auth',
  pageEvent: 'tidal-player:event',
  pageCommand: 'tidal-player:command',
  play: 'tidal:play',
  pause: 'tidal:pause',
  resume: 'tidal:resume',
  seek: 'tidal:seek',
  setVolume: 'tidal:set-volume',
  event: 'tidal:event'
} as const

export type TidalErrorKind = 'initialization' | 'authentication' | 'playback' | 'permission'

/** What the player reports, in plain terms the rest of the app understands. */
export type TidalPlayerEvent =
  /** TIDAL's player is set up and can be given a track. */
  | { type: 'ready' }
  | {
      type: 'state'
      trackId: string | null
      paused: boolean
      positionMs: number
      durationMs: number
      ended: boolean
    }
  | { type: 'error'; kind: TidalErrorKind; message: string }
  /** A keyboard media key (or Control Center button) was pressed while the hidden player held the system's media controls. */
  | { type: 'media-key'; action: MediaKeyAction }

/** What the main process can ask the player page to do. */
export type TidalPlayerCommand =
  | { type: 'load'; trackId: string }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'seek'; positionMs: number }
  | { type: 'setVolume'; volume: number }

/** What the app window may do with TIDAL playback. */
export interface TidalPlayerApi {
  play(trackId: string): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  seek(positionMs: number): Promise<void>
  setVolume(volume: number): Promise<void>
  /** Subscribes to player events; returns an unsubscribe function. */
  onEvent(listener: (event: TidalPlayerEvent) => void): () => void
}

/** What TIDAL's player needs to call its API: the app's client ID and a current access token. */
export interface TidalPlayerAuth {
  clientId: string
  token: string
}

/** The narrow bridge the hidden player page gets: nothing but its credentials, its events and its commands. */
export interface TidalPageBridge {
  getAuth(): Promise<TidalPlayerAuth>
  emit(event: TidalPlayerEvent): void
  onCommand(listener: (command: TidalPlayerCommand) => void): void
}

export const TIDAL_ERRORS = {
  initialization: `TIDAL's player could not start in ${APP_NAME}. Check your connection and try again.`,
  authentication: 'TIDAL rejected the sign-in. Reconnect TIDAL and try again.',
  notReady: "TIDAL's player did not start in time. Check your connection and try again.",
  loadFailed: "Couldn't load TIDAL's player. Check your connection and try again.",
  playback: 'TIDAL could not play this track.',
  otherDevice: 'TIDAL is playing on another device, which has ended playback here.',
  notStarted: "TIDAL didn't start playing. Try again."
} as const

const ERROR_KINDS: readonly string[] = ['initialization', 'authentication', 'playback', 'permission']
const MAX_MESSAGE_LENGTH = 500

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isNonNegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

/** The player page runs TIDAL's script, so nothing it sends is trusted: accept only well-formed events of exactly the shapes above. */
export function isTidalPlayerEvent(value: unknown): value is TidalPlayerEvent {
  if (!isRecord(value)) return false
  switch (value.type) {
    case 'ready':
      return true
    case 'state':
      return (
        (value.trackId === null || typeof value.trackId === 'string') &&
        typeof value.paused === 'boolean' &&
        isNonNegative(value.positionMs) &&
        isNonNegative(value.durationMs) &&
        typeof value.ended === 'boolean'
      )
    case 'error':
      return typeof value.kind === 'string' && ERROR_KINDS.includes(value.kind) && typeof value.message === 'string' && value.message.length <= MAX_MESSAGE_LENGTH
    case 'media-key':
      return typeof value.action === 'string' && MEDIA_KEY_ACTIONS.includes(value.action)
    default:
      return false
  }
}
