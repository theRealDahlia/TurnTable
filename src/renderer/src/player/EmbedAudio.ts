import type { EmbedChannel } from './EmbedBridge'
import { errorEvent, type PlayerMedia } from './media'
import { createSilentKeeper, type SessionKeeper } from './sessionKeeper'

/** The states an embedded player reports, whichever service it belongs to. */
export type EmbedState = 'unstarted' | 'ended' | 'playing' | 'paused' | 'buffering' | 'cued'

/** What one report from an embedded player means. */
export type EmbedReading =
  | { kind: 'state'; id: string | null; state: EmbedState; positionSeconds: number; durationSeconds: number }
  | { kind: 'error'; message: string }
  | { kind: 'load-failed' }
  | { kind: 'other' }

/** Everything that differs between services' embedded players: how to name and command them, and how to read them. */
export interface EmbedSpec<C, E> {
  /** The source scheme: `youtube` for `youtube:<id>`. */
  scheme: string
  /** The id if `id` is a valid one for this service. */
  parseId(id: string): string | undefined
  /** Said when asked to play a source that is not a valid track of this service. */
  invalidMessage: string
  messages: { notStarted: string; loadFailed: string }
  commands: { load(id: string): C; play: C; pause: C; seek(seconds: number): C; setVolume(volume: number): C }
  read(event: E): EmbedReading
}

/** The frame has to load the service's player script before anything plays, which can take a while on first use. */
const START_TIMEOUT_MS = 20_000
/** A pause or resume we just asked for outranks state reports that were already in flight. */
const COMMAND_GRACE_MS = 700

export interface EmbedAudioOptions {
  startTimeoutMs?: number
  now?: () => number
  /** Keeps the app's own media session alive while the embed plays, so the keyboard's skip keys reach the app. */
  keeper?: SessionKeeper
}

/**
 * Plays a `<scheme>:<id>` source through a service's embedded player, behaving like an audio element so the
 * same player engine drives it. The embed reports state as it changes and twice a second while playing;
 * this turns that into the media events the engine expects.
 */
export class EmbedAudio<C extends { type: string }, E extends { type: string }> extends EventTarget implements PlayerMedia {
  readonly error = null

  private trackId?: string
  /** Bumped whenever the source changes, so results for a superseded track are dropped. */
  private session = 0
  private started = false
  private matched = false
  private shownPlaying = false
  private hasPlayed = false
  /** The user paused before the track began, and the embed may still start it. */
  private pauseOnStart = false
  private isPaused = true
  private hasEnded = false
  private position = 0
  private total = Number.NaN
  private level = 1
  private lastCommand?: { at: number; paused: boolean }
  private unsubscribe?: () => void
  private startTimer?: ReturnType<typeof setTimeout>
  private readonly startTimeoutMs: number
  private readonly now: () => number
  private readonly keeper: SessionKeeper

  constructor(
    private readonly channel: EmbedChannel<C, E>,
    private readonly spec: EmbedSpec<C, E>,
    options: EmbedAudioOptions = {}
  ) {
    super()
    this.startTimeoutMs = options.startTimeoutMs ?? START_TIMEOUT_MS
    this.now = options.now ?? Date.now
    this.keeper = options.keeper ?? createSilentKeeper()
  }

  get src(): string {
    return this.trackId ? `${this.spec.scheme}:${this.trackId}` : ''
  }
  set src(source: string) {
    this.reset()
    const prefix = `${this.spec.scheme}:`
    this.trackId = source.startsWith(prefix) ? this.spec.parseId(source.slice(prefix.length)) : undefined
  }

  get currentTime(): number {
    return this.position
  }
  set currentTime(seconds: number) {
    this.position = seconds
    if (this.started) this.channel.send(this.spec.commands.seek(seconds))
  }

  get volume(): number {
    return this.level
  }
  set volume(volume: number) {
    this.level = volume
    if (this.started) this.channel.send(this.spec.commands.setVolume(volume))
  }

  get duration(): number {
    return this.total
  }
  get paused(): boolean {
    return this.isPaused
  }
  get ended(): boolean {
    return this.hasEnded
  }

  async play(): Promise<void> {
    if (!this.trackId) throw new Error(this.spec.invalidMessage)
    const session = this.session
    this.unsubscribe ??= this.channel.onEvent((event) => this.handle(event, session))
    this.isPaused = false
    this.hasEnded = false
    this.pauseOnStart = false
    this.keeper.start()

    if (this.started) {
      this.noteCommand(false)
      this.channel.send(this.spec.commands.play)
      return
    }

    this.started = true
    this.channel.request()
    this.channel.send(this.spec.commands.load(this.trackId))
    if (this.level !== 1) this.channel.send(this.spec.commands.setVolume(this.level))
    this.startTimer = setTimeout(() => {
      if (session === this.session && !this.matched) this.fail(this.spec.messages.notStarted)
    }, this.startTimeoutMs)
  }

  pause(): void {
    if (this.isPaused) return
    this.isPaused = true
    this.shownPlaying = false
    this.pauseOnStart = !this.hasPlayed
    this.noteCommand(true)
    this.keeper.stop()
    if (this.started) this.channel.send(this.spec.commands.pause)
    this.emit('pause')
  }

  removeAttribute(name: 'src'): void {
    if (name === 'src') this.reset()
  }

  load(): void {}

  private handle(raw: E, session: number): void {
    if (session !== this.session || !this.trackId || !this.started) return
    const event = this.spec.read(raw)
    if (event.kind === 'load-failed') return this.fail(this.spec.messages.loadFailed)
    if (event.kind === 'error') return this.fail(event.message)
    if (event.kind !== 'state') return

    // Reports for another track (the one we just left, say) are not ours.
    if (event.id !== this.trackId) return
    if (!this.matched) {
      this.matched = true
      clearTimeout(this.startTimer)
    }

    if (event.durationSeconds > 0 && event.durationSeconds !== this.total) {
      this.total = event.durationSeconds
      this.emit('durationchange')
    }
    this.position = event.positionSeconds

    switch (event.state) {
      case 'ended':
        if (!this.hasPlayed) return
        this.hasEnded = true
        this.isPaused = true
        this.shownPlaying = false
        this.keeper.stop()
        this.emit('ended')
        return
      case 'playing':
        if (this.pauseOnStart) {
          // The embed began the track after the user had already asked for it to wait.
          this.pauseOnStart = false
          this.channel.send(this.spec.commands.pause)
          return
        }
        if (this.contradicts(false)) return
        if (!this.shownPlaying) {
          this.shownPlaying = true
          this.hasPlayed = true
          this.isPaused = false
          this.keeper.start()
          this.emit('playing')
        }
        break
      case 'paused':
        if (this.contradicts(true)) return
        if (this.shownPlaying) {
          this.shownPlaying = false
          this.isPaused = true
          this.keeper.stop()
          this.emit('pause')
        }
        break
      case 'buffering':
        // Stalled mid-song: show it, and announce playback again once it resumes.
        if (this.shownPlaying && !this.isPaused) {
          this.shownPlaying = false
          this.emit('waiting')
        }
        return
      default:
        return
    }
    this.emit('timeupdate')
  }

  /** Whether a report that the track is `paused` (or not) is an old one, overtaken by a command we just sent. */
  private contradicts(paused: boolean): boolean {
    return this.lastCommand !== undefined && this.now() - this.lastCommand.at < COMMAND_GRACE_MS && paused !== this.lastCommand.paused
  }

  private noteCommand(paused: boolean): void {
    this.lastCommand = { at: this.now(), paused }
  }

  private emit(type: string): void {
    this.dispatchEvent(new Event(type))
  }

  private fail(message: string): void {
    this.stop()
    this.dispatchEvent(errorEvent(message))
  }

  /** Playback of this source is over (failed or never started); the next play() starts afresh. */
  private stop(): void {
    clearTimeout(this.startTimer)
    this.keeper.stop()
    this.started = false
    this.matched = false
    this.shownPlaying = false
    this.pauseOnStart = false
    this.isPaused = true
  }

  private reset(): void {
    this.session++
    // Leaving a track that is still playing must silence it.
    if (this.started) this.channel.send(this.spec.commands.pause)
    this.stop()
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.trackId = undefined
    this.hasPlayed = false
    this.hasEnded = false
    this.position = 0
    this.total = Number.NaN
    this.lastCommand = undefined
  }
}
