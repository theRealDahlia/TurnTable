/** The part of an HTMLAudioElement the player uses, so another source (Spotify) can stand in for it. */
export interface PlayerMedia extends EventTarget {
  src: string
  currentTime: number
  volume: number
  readonly duration: number
  readonly paused: boolean
  readonly ended: boolean
  readonly error: { readonly code: number } | null
  play(): Promise<void>
  pause(): void
  removeAttribute(name: 'src'): void
  load(): void
}

/** The events the player listens for; sources other than a real <audio> element raise these themselves. */
export const MEDIA_EVENTS = ['playing', 'waiting', 'pause', 'timeupdate', 'durationchange', 'ended', 'error'] as const

/** An `error` event carrying a message for the user, for failures that have no MediaError code. */
export const errorEvent = (message: string): Event => new CustomEvent('error', { detail: message })

/** The message attached by `errorEvent`, if this event has one. */
export function errorMessageOf(event: Event): string | undefined {
  return 'detail' in event && typeof event.detail === 'string' ? event.detail : undefined
}
