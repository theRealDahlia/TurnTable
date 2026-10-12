/** What an embedded-player adapter (`EmbedAudio`) needs from the frame that runs a service's player. */
export interface EmbedChannel<C, E> {
  /** Asks for the player frame to be put on screen; playback can't start without it. */
  request(): void
  /** Delivers a command once the player is ready, in order. */
  send(command: C): void
  /** Subscribes to what the player reports; returns an unsubscribe function. */
  onEvent(listener: (event: E) => void): () => void
}

/** The frame's window, as far as the bridge needs to talk to it. */
export interface FrameWindow {
  postMessage(message: unknown, targetOrigin: string): void
}

/** What the on-screen frame needs from its bridge: to be asked for, and to be attached to. */
export interface FrameHost {
  /** For `useSyncExternalStore`: whether the frame has been asked for (it then stays mounted). */
  isRequested(): boolean
  subscribe(callback: () => void): () => void
  /** Starts talking to the player in `frame`, whose page is served from `origin`. Returns a function that stops. */
  attach(frame: FrameWindow, origin: string): () => void
}

interface Target {
  frame: FrameWindow
  origin: string
}

/**
 * Connects the player engine to a service's own player, which lives in a frame on screen (YouTube and SoundCloud
 * both require their player to be visible). React mounts the frame, the engine asks for it and sends commands;
 * this holds the two together, and only believes messages that really come from that frame.
 */
export class EmbedBridge<C extends { type: string }, E extends { type: string }> implements EmbedChannel<C, E>, FrameHost {
  private requested = false
  private target?: Target
  private ready = false
  private queue: C[] = []
  private readonly listeners = new Set<(event: E) => void>()
  private readonly subscribers = new Set<() => void>()

  /**
   * `isEvent` is the check that a message from the frame is one this service's player can send. `host` is where
   * the frame's messages arrive: the app window unless a test says otherwise.
   */
  constructor(
    private readonly isEvent: (value: unknown) => value is E,
    private readonly host?: EventTarget
  ) {}

  /** For `useSyncExternalStore`: whether the frame has been asked for (it then stays mounted). */
  readonly isRequested = (): boolean => this.requested
  readonly subscribe = (callback: () => void): (() => void) => {
    this.subscribers.add(callback)
    return () => void this.subscribers.delete(callback)
  }

  request(): void {
    if (this.requested) return
    this.requested = true
    for (const callback of this.subscribers) callback()
  }

  send(command: C): void {
    if (this.target && this.ready) {
      this.target.frame.postMessage(command, this.target.origin)
      return
    }
    // A newer video replaces whatever was waiting for the player, so a pile of old commands can't build up.
    if (command.type === 'load') this.queue = []
    this.queue.push(command)
  }

  onEvent(listener: (event: E) => void): () => void {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }

  /** Starts talking to the player in `frame`, whose page is served from `origin`. Returns a function that stops. */
  attach(frame: FrameWindow, origin: string): () => void {
    const target: Target = { frame, origin }
    this.target = target
    this.ready = false

    const onMessage = (event: Event): void => {
      const { source, origin: from, data } = event as MessageEvent
      // The frame holds YouTube's code: only its own page, at its own origin, and only well-formed events.
      if (source !== frame || from !== origin || !this.isEvent(data)) return
      if (data.type === 'ready') this.flush(target)
      for (const listener of [...this.listeners]) listener(data)
    }
    const host = this.host ?? window
    host.addEventListener('message', onMessage)

    return () => {
      host.removeEventListener('message', onMessage)
      if (this.target === target) {
        this.target = undefined
        this.ready = false
      }
    }
  }

  private flush(target: Target): void {
    if (this.target !== target) return
    this.ready = true
    const pending = this.queue
    this.queue = []
    for (const command of pending) target.frame.postMessage(command, target.origin)
  }
}
