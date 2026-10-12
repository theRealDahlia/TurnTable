import type { QobuzStream } from '@shared/qobuz'
import { errorEvent, MEDIA_EVENTS, type PlayerMedia } from './media'

const SOURCE_PREFIX = 'qobuz:'
/** A Qobuz track id is a plain number. */
const TRACK_ID = /^\d{1,12}$/

/** The id inside a `qobuz:<id>` source, or undefined if the text is anything else. */
export function qobuzTrackIdFromSource(src: string): string | undefined {
  if (!src.startsWith(SOURCE_PREFIX)) return undefined
  const id = src.slice(SOURCE_PREFIX.length)
  return TRACK_ID.test(id) ? id : undefined
}

/** `MediaError.MEDIA_ERR_NETWORK` and `MEDIA_ERR_SRC_NOT_SUPPORTED`: what a stream address that has expired looks like. */
const RETRYABLE_ERRORS: readonly number[] = [2, 4]

export interface QobuzAudioOptions {
  createAudio?: () => HTMLAudioElement
}

/**
 * Plays a `qobuz:<id>` source. Qobuz hands out a short-lived address for each stream, signed for this
 * application, so playing means asking for one first and then playing it in an <audio> element of its own: FLAC up
 * to 24-bit / 192 kHz goes straight to the output as decoded, like a local file. If the address has lapsed by
 * the time playback resumes, a fresh one is fetched once and playback carries on from where it was.
 */
export class QobuzAudio extends EventTarget implements PlayerMedia {
  private readonly element: HTMLAudioElement
  private trackId?: string
  /** Bumped whenever the source changes, so an address that arrives for a superseded track is dropped. */
  private session = 0
  private prepared = false
  private preparing?: Promise<void>
  private retried = false
  private pendingPosition?: number
  private level = 1

  constructor(
    private readonly getStream: (trackId: string) => Promise<QobuzStream>,
    options: QobuzAudioOptions = {}
  ) {
    super()
    this.element = (options.createAudio ?? (() => new Audio()))()
    for (const type of MEDIA_EVENTS) {
      this.element.addEventListener(type, (event) => {
        if (type === 'error' && this.maybeRecover()) return
        this.forward(event)
      })
    }
  }

  get src(): string {
    return this.trackId ? `${SOURCE_PREFIX}${this.trackId}` : ''
  }
  set src(source: string) {
    this.reset()
    this.trackId = qobuzTrackIdFromSource(source)
  }

  get currentTime(): number {
    return this.pendingPosition ?? this.element.currentTime
  }
  set currentTime(seconds: number) {
    if (this.prepared) this.element.currentTime = seconds
    else this.pendingPosition = seconds
  }

  get volume(): number {
    return this.level
  }
  set volume(volume: number) {
    this.level = volume
    this.element.volume = volume
  }

  get duration(): number {
    return this.prepared ? this.element.duration : Number.NaN
  }
  get paused(): boolean {
    return this.element.paused
  }
  get ended(): boolean {
    return this.element.ended
  }
  get error(): { readonly code: number } | null {
    return this.element.error
  }

  async play(): Promise<void> {
    if (!this.trackId) throw new Error('That is not a valid Qobuz track.')
    const session = this.session
    await this.prepare()
    // The track was changed while its address was being fetched; whatever is playing now is not this.
    if (session !== this.session) return
    await this.element.play()
  }

  pause(): void {
    this.element.pause()
  }

  removeAttribute(name: 'src'): void {
    if (name === 'src') this.reset()
  }

  load(): void {}

  /** Fetches the stream address and gives it to the element, once for each track. */
  private prepare(): Promise<void> {
    if (this.prepared) return Promise.resolve()
    this.preparing ??= this.fetchAndAttach()
    return this.preparing
  }

  private async fetchAndAttach(): Promise<void> {
    const session = this.session
    const trackId = this.trackId
    if (!trackId) return
    try {
      const stream = await this.getStream(trackId)
      // The track was changed while Qobuz was being asked, so this address is not wanted.
      if (session !== this.session) return
      this.element.volume = this.level
      this.element.src = stream.url
      this.prepared = true
      if (this.pendingPosition !== undefined) {
        this.element.currentTime = this.pendingPosition
        this.pendingPosition = undefined
      }
    } catch (error) {
      // Qobuz's own message (no subscription, preview only, signed out...) is what the user reads: play() rejects with it.
      if (session === this.session) this.preparing = undefined
      throw error
    } finally {
      if (session === this.session && this.prepared) this.preparing = undefined
    }
  }

  /** An address that has lapsed shows up as a network or source error; fetch a new one once and carry on. */
  private maybeRecover(): boolean {
    const code = this.element.error?.code
    if (!this.prepared || this.retried || code === undefined || !RETRYABLE_ERRORS.includes(code)) return false
    const trackId = this.trackId
    if (!trackId) return false
    this.retried = true
    const session = this.session
    const position = this.element.currentTime
    this.getStream(trackId).then(
      async (stream) => {
        if (session !== this.session) return
        this.element.src = stream.url
        this.element.currentTime = position
        await this.element.play().catch(() => undefined)
      },
      () => {
        if (session === this.session) this.dispatchEvent(errorEvent('Qobuz could not stream this track. Try playing it again.'))
      }
    )
    return true
  }

  /** An event can only be dispatched once, so pass on a copy. */
  private forward(event: Event): void {
    this.dispatchEvent(event instanceof CustomEvent ? new CustomEvent(event.type, { detail: event.detail }) : new Event(event.type))
  }

  private reset(): void {
    this.session++
    this.element.pause()
    this.element.removeAttribute('src')
    this.element.load()
    this.trackId = undefined
    this.prepared = false
    this.preparing = undefined
    this.retried = false
    this.pendingPosition = undefined
  }
}
