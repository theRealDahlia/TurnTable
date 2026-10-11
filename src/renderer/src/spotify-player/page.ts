import type { MediaKeyAction, PlayerPageBridge, SpotifyPlayerEvent } from '@shared/spotifyPlayer'
import { SPOTIFY_ERRORS } from '@shared/spotifyPlayer'
import { APP_NAME } from '@shared/app'

/** The slice of Spotify's Web Playback SDK this page uses. */
export interface SdkTrack {
  id: string | null
  /** Present when Spotify swapped in a regional variant of the track that was asked for. */
  linked_from?: { id: string | null } | null
}
export interface SdkState {
  paused: boolean
  position: number
  duration?: number
  track_window: { current_track: (SdkTrack & { duration_ms?: number }) | null; previous_tracks: SdkTrack[] }
}
export interface SdkPlayer {
  addListener(event: string, callback: (payload: never) => void): boolean
  connect(): Promise<boolean>
  disconnect(): void
  pause(): Promise<void>
  resume(): Promise<void>
  seek(positionMs: number): Promise<void>
  setVolume(volume: number): Promise<void>
  getCurrentState(): Promise<SdkState | null>
}
export interface SpotifyNamespace {
  Player: new (options: { name: string; getOAuthToken: (callback: (token: string) => void) => void; volume?: number }) => SdkPlayer
}

/** The slice of the browser's Media Session this page uses. */
export interface MediaSessionLike {
  setActionHandler(action: 'nexttrack' | 'previoustrack' | 'play' | 'pause', handler: (() => void) | null): void
}

export interface PageOptions {
  /** Where the system's media keys are routed; the browser's own by default. */
  mediaSession?: MediaSessionLike
  pollMs?: number
  setInterval?: (callback: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
}

/** Translates the SDK's state into the app's event; a finished track shows up as paused at 0 with itself in `previous_tracks`. */
export function toStateEvent(state: SdkState): SpotifyPlayerEvent {
  const current = state.track_window.current_track
  const ended = state.paused && state.position === 0 && !!current?.id && state.track_window.previous_tracks.some((track) => track.id === current.id)
  return {
    type: 'state',
    trackId: current?.id ?? null,
    linkedFromId: current?.linked_from?.id ?? null,
    paused: state.paused,
    positionMs: state.position,
    durationMs: state.duration ?? current?.duration_ms ?? 0,
    ended
  }
}

/** Runs inside the hidden player page: creates the SDK player, reports its events, and obeys commands. */
export function startPlayerPage(bridge: PlayerPageBridge, sdk: SpotifyNamespace, options: PageOptions = {}): SdkPlayer {
  const { pollMs = 500, setInterval: startTimer = (cb, ms) => window.setInterval(cb, ms), clearInterval: stopTimer = (h) => window.clearInterval(h as number) } = options

  const player = new sdk.Player({
    name: APP_NAME,
    volume: 1,
    getOAuthToken: (callback) => {
      bridge.getToken().then(callback, (error: unknown) => {
        bridge.emit({ type: 'error', kind: 'permission', message: error instanceof Error ? error.message : 'Spotify sign-in is required.' })
      })
    }
  })

  const on = <T>(event: string, callback: (payload: T) => void): void => {
    player.addListener(event, callback as (payload: never) => void)
  }

  on<{ device_id: string }>('ready', ({ device_id }) => bridge.emit({ type: 'ready', deviceId: device_id }))
  on('not_ready', () => bridge.emit({ type: 'not-ready' }))
  on('initialization_error', () => bridge.emit({ type: 'error', kind: 'initialization', message: SPOTIFY_ERRORS.initialization }))
  on('authentication_error', () => bridge.emit({ type: 'error', kind: 'authentication', message: SPOTIFY_ERRORS.authentication }))
  on('account_error', () => bridge.emit({ type: 'error', kind: 'account', message: SPOTIFY_ERRORS.premium }))
  on<{ message: string }>('playback_error', ({ message }) =>
    bridge.emit({ type: 'error', kind: 'playback', message: message ? `Spotify could not play this track: ${message}` : 'Spotify could not play this track.' })
  )

  // The SDK only reports changes, so poll while playing to keep the position moving.
  let timer: unknown
  const report = (state: SdkState | null): void => {
    if (!state) return
    bridge.emit(toStateEvent(state))
    if (!state.paused && timer === undefined) {
      timer = startTimer(() => void player.getCurrentState().then(report, () => undefined), pollMs)
    } else if (state.paused && timer !== undefined) {
      stopTimer(timer)
      timer = undefined
    }
  }
  on<SdkState>('player_state_changed', report)

  bridge.onCommand((command) => {
    switch (command.type) {
      case 'pause':
        return void player.pause()
      case 'resume':
        return void player.resume()
      case 'seek':
        return void player.seek(Math.max(0, Math.round(command.positionMs)))
      case 'setVolume':
        return void player.setVolume(Math.min(1, Math.max(0, command.volume)))
    }
  })

  // While this page is the one playing, the system sends the media keys here, so pass them on to the app.
  const session = options.mediaSession ?? (typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : undefined)
  const keys: ['nexttrack' | 'previoustrack' | 'play' | 'pause', MediaKeyAction][] = [
    ['nexttrack', 'next'],
    ['previoustrack', 'previous'],
    ['play', 'toggle'],
    ['pause', 'toggle']
  ]
  for (const [action, key] of keys) session?.setActionHandler(action, () => bridge.emit({ type: 'media-key', action: key }))

  void player.connect()
  return player
}
