import { YOUTUBE_VIDEO_ID, describeYouTubeError, type YouTubePlayerCommand, type YouTubePlayerEvent } from '@shared/youtubePlayer'
import { EmbedAudio, type EmbedAudioOptions, type EmbedReading, type EmbedSpec } from './EmbedAudio'
import type { YouTubeChannel } from './YouTubeBridge'

/** The id inside a `youtube:<id>` source, or undefined if the text is anything else. */
export function youtubeVideoIdFromSource(src: string): string | undefined {
  return src.startsWith('youtube:') && YOUTUBE_VIDEO_ID.test(src.slice('youtube:'.length)) ? src.slice('youtube:'.length) : undefined
}

export const YOUTUBE_ERRORS = {
  notStarted: "YouTube didn't start playing. Try again.",
  loadFailed: "Couldn't load YouTube's player. Check your connection and try again."
} as const

function read(event: YouTubePlayerEvent): EmbedReading {
  switch (event.type) {
    case 'state':
      return { kind: 'state', id: event.videoId, state: event.state, positionSeconds: event.positionSeconds, durationSeconds: event.durationSeconds }
    case 'error':
      return { kind: 'error', message: describeYouTubeError(event.code) }
    case 'load-failed':
      return { kind: 'load-failed' }
    default:
      return { kind: 'other' }
  }
}

const SPEC: EmbedSpec<YouTubePlayerCommand, YouTubePlayerEvent> = {
  scheme: 'youtube',
  parseId: (id) => (YOUTUBE_VIDEO_ID.test(id) ? id : undefined),
  invalidMessage: 'That is not a valid YouTube video.',
  messages: YOUTUBE_ERRORS,
  commands: {
    load: (videoId) => ({ type: 'load', videoId }),
    play: { type: 'play' },
    pause: { type: 'pause' },
    seek: (seconds) => ({ type: 'seek', seconds }),
    setVolume: (volume) => ({ type: 'setVolume', volume })
  },
  read
}

export type YouTubeAudioOptions = EmbedAudioOptions

/** Plays a `youtube:<id>` source through YouTube's embedded player. */
export class YouTubeAudio extends EmbedAudio<YouTubePlayerCommand, YouTubePlayerEvent> {
  constructor(channel: YouTubeChannel, options: YouTubeAudioOptions = {}) {
    super(channel, SPEC, options)
  }
}
