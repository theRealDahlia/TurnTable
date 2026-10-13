import { TIDAL_ERRORS, type TidalPlayerCommand, type TidalPlayerEvent } from '@shared/tidalPlayer'

/** The hidden window that runs TIDAL's player; abstract so the logic can be tested without Electron. */
export interface PlayerWindow {
  load(): Promise<void>
  send(command: TidalPlayerCommand): void
  destroy(): void
}

export interface HostDeps {
  createWindow(): PlayerWindow
  /** Sends player events on to the app window(s). */
  emit(event: TidalPlayerEvent): void
  readyTimeoutMs?: number
}

const DEFAULT_READY_TIMEOUT_MS = 20_000

/** Starts TIDAL's player on demand, waits until it is ready, and relays its events and our commands. */
export class TidalPlayerHost {
  private window?: PlayerWindow
  private isReady = false
  private ready?: { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void }

  constructor(private readonly deps: HostDeps) {}

  /** Plays one TIDAL track, starting the player first if needed. */
  async play(trackId: string): Promise<void> {
    await this.ensureReady()
    this.send({ type: 'load', trackId })
  }

  send(command: TidalPlayerCommand): void {
    this.window?.send(command)
  }

  /** Called with every event the player page reports. */
  handleEvent(event: TidalPlayerEvent): void {
    switch (event.type) {
      case 'ready':
        this.isReady = true
        this.ready?.resolve()
        this.ready = undefined
        break
      case 'error':
        // Problems that mean the player can't work are fatal to a pending start and to this player instance.
        if (event.kind !== 'playback') {
          this.ready?.reject(new Error(event.message))
          this.dispose()
        }
        break
      case 'state':
        break
    }
    this.deps.emit(event)
  }

  dispose(): void {
    this.window?.destroy()
    this.window = undefined
    this.isReady = false
    this.ready = undefined
  }

  private ensureReady(): Promise<void> {
    if (this.isReady) return Promise.resolve()
    if (this.ready) return this.ready.promise

    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
    // Handled by whoever awaits `promise`; this just prevents an unhandled rejection if nobody is waiting.
    promise.catch(() => undefined)
    const ready = { promise, resolve, reject }
    this.ready = ready

    const timer = setTimeout(() => {
      if (this.ready !== ready) return
      reject(new Error(TIDAL_ERRORS.notReady))
      this.dispose()
    }, this.deps.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS)
    void promise.then(
      () => clearTimeout(timer),
      () => clearTimeout(timer)
    )

    if (!this.window) {
      this.window = this.deps.createWindow()
      this.window.load().catch(() => {
        if (this.ready !== ready) return
        reject(new Error(TIDAL_ERRORS.loadFailed))
        this.dispose()
      })
    }
    return promise
  }
}
