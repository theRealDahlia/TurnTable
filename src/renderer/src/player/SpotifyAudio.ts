import { spotifyTrackIdFromUri } from '@shared/media'
import type { SpotifyPlayerApi, SpotifyPlayerEvent } from '@shared/spotifyPlayer'
import { errorEvent, type PlayerMedia } from './media'

/** How long to wait for Spotify to report that the track we asked for is actually playing. */
const START_TIMEOUT_MS = 15_000
/** A pause or resume we just asked for outranks state reports that were already in flight. */
const COMMAND_GRACE_MS = 700

export interface SpotifyAudioOptions {
  startTimeoutMs?: number
  now?: () => number
}

/**
 * Plays a `spotify:track:<id>` source through Spotify's hidden player, behaving like an audio element so
 * the same player engine drives it. Spotify reports state a couple of times a second; this turns that
 * into the media events the engine expects.
 */
export class SpotifyAudio extends EventTarget implements PlayerMedia {
  readonly error = null

  private trackId?: string
  /** The id Spotify reports once playing, which differs from the requested one when it swaps in a regional variant. */
  private actualId?: string
  /** Bumped whenever the source changes, so results for a superseded track are dropped. */
  private session = 0
  private started = false
  private matched = false
  private shownPlaying = false
  private hasPlayed = false
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

  constructor(
    private readonly getApi: () => SpotifyPlayerApi,
    options: SpotifyAudioOptions = {}
  ) {
    super()
    this.startTimeoutMs = options.startTimeoutMs ?? START_TIMEOUT_MS
    this.now = options.now ?? Date.now
  }

  get src(): string {
    return this.trackId ? `spotify:track:${this.trackId}` : ''
  }
  set src(uri: string) {
    this.reset()
    this.trackId = spotifyTrackIdFromUri(uri)
  }

  get currentTime(): number {
    return this.position
  }
  set currentTime(seconds: number) {
    this.position = seconds
    if (this.started) void this.getApi().seek(Math.round(seconds * 1000)).catch(() => undefined)
  }

  get volume(): number {
    return this.level
  }
  set volume(volume: number) {
    this.level = volume
    if (this.started) void this.getApi().setVolume(volume).catch(() => undefined)
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
    if (!this.trackId) throw new Error('That is not a valid Spotify track.')
    const api = this.getApi()
    const session = this.session
    this.unsubscribe ??= api.onEvent((event) => this.handle(event))
    this.isPaused = false
    this.hasEnded = false

    if (this.started) {
      this.noteCommand(false)
      await api.resume()
      return
    }

    this.started = true
    try {
      await api.play(this.trackId)
    } catch (error) {
      if (session === this.session) this.stop()
      throw error
    }
    // The track was changed, or the user pressed pause, while Spotify was starting.
    if (session !== this.session) return
    if (this.isPaused) void api.pause().catch(() => undefined)
    if (this.level !== 1) void api.setVolume(this.level).catch(() => undefined)
    this.startTimer = setTimeout(() => {
      if (session === this.session && !this.matched) this.fail("Spotify didn't start playing. Try again.")
    }, this.startTimeoutMs)
  }

  pause(): void {
    if (this.isPaused) return
    this.isPaused = true
    this.shownPlaying = false
    this.noteCommand(true)
    if (this.started) void this.getApi().pause().catch(() => undefined)
    this.emit('pause')
  }

  removeAttribute(name: 'src'): void {
    if (name === 'src') this.reset()
  }

  load(): void {}

  private handle(event: SpotifyPlayerEvent): void {
    if (!this.trackId || !this.started) return
    if (event.type === 'error') return this.fail(event.message)
    if (event.type !== 'state') return

    // Reports for another track (the one we just left, say) are not ours.
    if (event.trackId !== (this.actualId ?? this.trackId) && event.linkedFromId !== this.trackId) return
    if (!this.matched) {
      this.matched = true
      clearTimeout(this.startTimer)
    }
    this.actualId = event.trackId ?? this.actualId

    const duration = event.durationMs / 1000
    if (duration > 0 && duration !== this.total) {
      this.total = duration
      this.emit('durationchange')
    }
    this.position = event.positionMs / 1000

    if (event.ended && this.hasPlayed) {
      this.hasEnded = true
      this.isPaused = true
      this.shownPlaying = false
      this.emit('ended')
      return
    }

    const contradictsCommand = this.lastCommand !== undefined && this.now() - this.lastCommand.at < COMMAND_GRACE_MS && event.paused !== this.lastCommand.paused
    const paused = contradictsCommand ? this.isPaused : event.paused
    if (!paused && !this.shownPlaying) {
      this.shownPlaying = true
      this.hasPlayed = true
      this.isPaused = false
      this.emit('playing')
    } else if (paused && this.shownPlaying) {
      this.shownPlaying = false
      this.isPaused = true
      this.emit('pause')
    }
    this.emit('timeupdate')
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
    this.started = false
    this.matched = false
    this.shownPlaying = false
    this.isPaused = true
  }

  private reset(): void {
    this.session++
    this.stop()
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.trackId = undefined
    this.actualId = undefined
    this.hasPlayed = false
    this.hasEnded = false
    this.position = 0
    this.total = Number.NaN
    this.lastCommand = undefined
  }
}
