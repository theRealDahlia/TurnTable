import { YOUTUBE_VIDEO_ID, describeYouTubeError, type YouTubePlayerEvent } from '@shared/youtubePlayer'
import { errorEvent, type PlayerMedia } from './media'
import { createSilentKeeper, type SessionKeeper } from './sessionKeeper'
import type { YouTubeChannel } from './YouTubeBridge'

const SOURCE_PREFIX = 'youtube:'

/** The id inside a `youtube:<id>` source, or undefined if the text is anything else. */
export function youtubeVideoIdFromSource(src: string): string | undefined {
  if (!src.startsWith(SOURCE_PREFIX)) return undefined
  const id = src.slice(SOURCE_PREFIX.length)
  return YOUTUBE_VIDEO_ID.test(id) ? id : undefined
}

export const YOUTUBE_ERRORS = {
  notStarted: "YouTube didn't start playing. Try again.",
  loadFailed: "Couldn't load YouTube's player. Check your connection and try again."
} as const

/** The frame has to load YouTube's player script before anything plays, which can take a while on first use. */
const START_TIMEOUT_MS = 20_000
/** A pause or resume we just asked for outranks state reports that were already in flight. */
const COMMAND_GRACE_MS = 700

export interface YouTubeAudioOptions {
  startTimeoutMs?: number
  now?: () => number
  /** Keeps the app's own media session alive while YouTube plays, so the keyboard's skip keys reach the app. */
  keeper?: SessionKeeper
}

/**
 * Plays a `youtube:<id>` source through YouTube's embedded player, behaving like an audio element so the
 * same player engine drives it. The embed reports state as it changes and twice a second while playing;
 * this turns that into the media events the engine expects.
 */
export class YouTubeAudio extends EventTarget implements PlayerMedia {
  readonly error = null

  private videoId?: string
  /** Bumped whenever the source changes, so results for a superseded video are dropped. */
  private session = 0
  private started = false
  private matched = false
  private shownPlaying = false
  private hasPlayed = false
  /** The user paused before the video began, and YouTube may still start it. */
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
    private readonly channel: YouTubeChannel,
    options: YouTubeAudioOptions = {}
  ) {
    super()
    this.startTimeoutMs = options.startTimeoutMs ?? START_TIMEOUT_MS
    this.now = options.now ?? Date.now
    this.keeper = options.keeper ?? createSilentKeeper()
  }

  get src(): string {
    return this.videoId ? `${SOURCE_PREFIX}${this.videoId}` : ''
  }
  set src(source: string) {
    this.reset()
    this.videoId = youtubeVideoIdFromSource(source)
  }

  get currentTime(): number {
    return this.position
  }
  set currentTime(seconds: number) {
    this.position = seconds
    if (this.started) this.channel.send({ type: 'seek', seconds })
  }

  get volume(): number {
    return this.level
  }
  set volume(volume: number) {
    this.level = volume
    if (this.started) this.channel.send({ type: 'setVolume', volume })
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
    if (!this.videoId) throw new Error('That is not a valid YouTube video.')
    const session = this.session
    this.unsubscribe ??= this.channel.onEvent((event) => this.handle(event, session))
    this.isPaused = false
    this.hasEnded = false
    this.pauseOnStart = false
    this.keeper.start()

    if (this.started) {
      this.noteCommand(false)
      this.channel.send({ type: 'play' })
      return
    }

    this.started = true
    this.channel.request()
    this.channel.send({ type: 'load', videoId: this.videoId })
    if (this.level !== 1) this.channel.send({ type: 'setVolume', volume: this.level })
    this.startTimer = setTimeout(() => {
      if (session === this.session && !this.matched) this.fail(YOUTUBE_ERRORS.notStarted)
    }, this.startTimeoutMs)
  }

  pause(): void {
    if (this.isPaused) return
    this.isPaused = true
    this.shownPlaying = false
    this.pauseOnStart = !this.hasPlayed
    this.noteCommand(true)
    this.keeper.stop()
    if (this.started) this.channel.send({ type: 'pause' })
    this.emit('pause')
  }

  removeAttribute(name: 'src'): void {
    if (name === 'src') this.reset()
  }

  load(): void {}

  private handle(event: YouTubePlayerEvent, session: number): void {
    if (session !== this.session || !this.videoId || !this.started) return
    if (event.type === 'load-failed') return this.fail(YOUTUBE_ERRORS.loadFailed)
    if (event.type === 'error') return this.fail(describeYouTubeError(event.code))
    if (event.type !== 'state') return

    // Reports for another video (the one we just left, say) are not ours.
    if (event.videoId !== this.videoId) return
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
          // YouTube began the video after the user had already asked for it to wait.
          this.pauseOnStart = false
          this.channel.send({ type: 'pause' })
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

  /** Whether a report that the video is `paused` (or not) is an old one, overtaken by a command we just sent. */
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
    // Leaving a video that is still playing must silence it.
    if (this.started) this.channel.send({ type: 'pause' })
    this.stop()
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.videoId = undefined
    this.hasPlayed = false
    this.hasEnded = false
    this.position = 0
    this.total = Number.NaN
    this.lastCommand = undefined
  }
}
