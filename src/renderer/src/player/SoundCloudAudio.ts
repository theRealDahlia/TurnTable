import { SOUNDCLOUD_TRACK_ID, describeSoundCloudError, type SoundCloudPlayerCommand, type SoundCloudPlayerEvent } from '@shared/soundcloudPlayer'
import { EmbedAudio, type EmbedAudioOptions, type EmbedReading, type EmbedSpec } from './EmbedAudio'
import type { SoundCloudChannel } from './SoundCloudBridge'

/** The id inside a `soundcloud:<id>` source, or undefined if the text is anything else. */
export function soundcloudTrackIdFromSource(src: string): string | undefined {
  const id = src.startsWith('soundcloud:') ? src.slice('soundcloud:'.length) : ''
  return SOUNDCLOUD_TRACK_ID.test(id) ? id : undefined
}

export const SOUNDCLOUD_ERRORS = {
  notStarted: "SoundCloud didn't start playing. Try again.",
  loadFailed: "Couldn't load SoundCloud's player. Check your connection and try again."
} as const

function read(event: SoundCloudPlayerEvent): EmbedReading {
  switch (event.type) {
    case 'state':
      return { kind: 'state', id: event.trackId, state: event.state, positionSeconds: event.positionSeconds, durationSeconds: event.durationSeconds }
    case 'error':
      return { kind: 'error', message: describeSoundCloudError(event.code) }
    case 'load-failed':
      return { kind: 'load-failed' }
    default:
      return { kind: 'other' }
  }
}

const SPEC: EmbedSpec<SoundCloudPlayerCommand, SoundCloudPlayerEvent> = {
  scheme: 'soundcloud',
  parseId: (id) => (SOUNDCLOUD_TRACK_ID.test(id) ? id : undefined),
  invalidMessage: 'That is not a valid SoundCloud track.',
  messages: SOUNDCLOUD_ERRORS,
  commands: {
    load: (trackId) => ({ type: 'load', trackId }),
    play: { type: 'play' },
    pause: { type: 'pause' },
    seek: (seconds) => ({ type: 'seek', seconds }),
    setVolume: (volume) => ({ type: 'setVolume', volume })
  },
  read
}

export type SoundCloudAudioOptions = EmbedAudioOptions

/** Plays a `soundcloud:<id>` source through SoundCloud's own player. */
export class SoundCloudAudio extends EmbedAudio<SoundCloudPlayerCommand, SoundCloudPlayerEvent> {
  constructor(channel: SoundCloudChannel, options: SoundCloudAudioOptions = {}) {
    super(channel, SPEC, options)
  }
}
