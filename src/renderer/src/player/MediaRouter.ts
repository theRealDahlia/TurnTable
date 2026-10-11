import { MEDIA_EVENTS, type PlayerMedia } from './media'

/** The scheme of a streaming source such as `spotify:track:<id>` or `youtube:<id>`; local files use a `scheme://` URL of their own. */
const schemeOf = (src: string): string | undefined => /^([a-z]+):(?!\/)/.exec(src)?.[1]

/**
 * Presents a local audio element and each streaming service's player as one audio source: setting `src`
 * picks the right backend by its scheme and silences the others, so the player engine can queue tracks
 * from all of them without caring.
 */
export class MediaRouter extends EventTarget implements PlayerMedia {
  private active: PlayerMedia
  private level = 1
  private readonly streams: ReadonlyMap<string, PlayerMedia>
  private readonly backends: PlayerMedia[]

  /** `sources` maps a scheme (`spotify`, `youtube`) to the backend that plays sources starting with it. */
  constructor(
    private readonly local: PlayerMedia,
    sources: Readonly<Record<string, PlayerMedia>>
  ) {
    super()
    this.active = local
    this.streams = new Map(Object.entries(sources))
    this.backends = [local, ...this.streams.values()]
    for (const backend of this.backends) {
      for (const type of MEDIA_EVENTS) {
        // Only the backend in use gets to speak, so the one we just left can't report its own shutdown.
        backend.addEventListener(type, (event) => {
          if (backend === this.active) this.forward(event)
        })
      }
    }
  }

  get src(): string {
    return this.active.src
  }
  set src(src: string) {
    const scheme = schemeOf(src)
    const next = (scheme !== undefined && this.streams.get(scheme)) || this.local
    if (next !== this.active) {
      const previous = this.active
      this.active = next
      previous.pause()
      previous.removeAttribute('src')
      next.volume = this.level
    }
    next.src = src
  }

  get currentTime(): number {
    return this.active.currentTime
  }
  set currentTime(seconds: number) {
    this.active.currentTime = seconds
  }

  get volume(): number {
    return this.level
  }
  set volume(volume: number) {
    this.level = volume
    for (const backend of this.backends) backend.volume = volume
  }

  get duration(): number {
    return this.active.duration
  }
  get paused(): boolean {
    return this.active.paused
  }
  get ended(): boolean {
    return this.active.ended
  }
  get error(): { readonly code: number } | null {
    return this.active.error
  }

  play(): Promise<void> {
    return this.active.play()
  }
  pause(): void {
    this.active.pause()
  }
  load(): void {
    this.active.load()
  }
  removeAttribute(name: 'src'): void {
    for (const backend of this.backends) backend.removeAttribute(name)
  }

  /** An event can only be dispatched once, so pass on a copy (keeping the message of custom error events). */
  private forward(event: Event): void {
    this.dispatchEvent(event instanceof CustomEvent ? new CustomEvent(event.type, { detail: event.detail }) : new Event(event.type))
  }
}
