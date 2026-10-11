import { SPOTIFY_ERRORS, type SpotifyPlayerCommand, type SpotifyPlayerEvent } from '@shared/spotifyPlayer'

/** The hidden window that runs Spotify's player; abstract so the logic can be tested without Electron. */
export interface PlayerWindow {
  load(): Promise<void>
  send(command: SpotifyPlayerCommand): void
  destroy(): void
}

export interface HostDeps {
  createWindow(): PlayerWindow
  /** Starts `trackId` on the SDK's device through Spotify's Web API. */
  startPlayback(deviceId: string, trackId: string): Promise<void>
  /** Sends player events on to the app window(s). */
  emit(event: SpotifyPlayerEvent): void
  readyTimeoutMs?: number
}

const DEFAULT_READY_TIMEOUT_MS = 20_000

/** Starts Spotify's player on demand, waits until it is ready, and relays its events and our commands. */
export class SpotifyPlayerHost {
  private window?: PlayerWindow
  private deviceId?: string
  private ready?: { promise: Promise<string>; resolve: (id: string) => void; reject: (error: Error) => void }

  constructor(private readonly deps: HostDeps) {}

  /** Plays one Spotify track, starting the player first if needed. */
  async play(trackId: string): Promise<void> {
    const deviceId = await this.ensureReady()
    await this.deps.startPlayback(deviceId, trackId)
  }

  send(command: SpotifyPlayerCommand): void {
    this.window?.send(command)
  }

  /** Called with every event the player page reports. */
  handleEvent(event: SpotifyPlayerEvent): void {
    switch (event.type) {
      case 'ready':
        this.deviceId = event.deviceId
        this.ready?.resolve(event.deviceId)
        this.ready = undefined
        break
      case 'not-ready':
        this.deviceId = undefined
        break
      case 'error':
        // Problems that mean the player can't work are fatal to a pending start and to this player instance.
        if (event.kind !== 'playback') {
          this.ready?.reject(new Error(event.message))
          this.dispose()
        }
        break
      case 'state':
      case 'media-key':
        break
    }
    this.deps.emit(event)
  }

  dispose(): void {
    this.window?.destroy()
    this.window = undefined
    this.deviceId = undefined
    this.ready = undefined
  }

  private ensureReady(): Promise<string> {
    if (this.deviceId) return Promise.resolve(this.deviceId)
    if (this.ready) return this.ready.promise

    let resolve!: (id: string) => void
    let reject!: (error: Error) => void
    const promise = new Promise<string>((res, rej) => {
      resolve = res
      reject = rej
    })
    // Handled by whoever awaits `promise`; this just prevents an unhandled rejection if nobody is waiting.
    promise.catch(() => undefined)
    const ready = { promise, resolve, reject }
    this.ready = ready

    const timer = setTimeout(() => {
      if (this.ready !== ready) return
      reject(new Error(SPOTIFY_ERRORS.notReady))
      this.dispose()
    }, this.deps.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS)
    void promise.then(
      () => clearTimeout(timer),
      () => clearTimeout(timer)
    )

    // After a `not-ready` the window is still there and will report `ready` again, so only start one if missing.
    if (!this.window) {
      this.window = this.deps.createWindow()
      this.window.load().catch(() => {
        if (this.ready !== ready) return
        reject(new Error(SPOTIFY_ERRORS.loadFailed))
        this.dispose()
      })
    }
    return promise
  }
}
