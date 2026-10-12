import { isYouTubePlayerEvent, type YouTubePlayerCommand, type YouTubePlayerEvent } from '@shared/youtubePlayer'
import { EmbedBridge, type EmbedChannel } from './EmbedBridge'

export type { FrameWindow } from './EmbedBridge'

/** What `YouTubeAudio` needs from the frame that runs YouTube's player. */
export type YouTubeChannel = EmbedChannel<YouTubePlayerCommand, YouTubePlayerEvent>

/** The bridge to YouTube's player frame. */
export class YouTubeBridge extends EmbedBridge<YouTubePlayerCommand, YouTubePlayerEvent> {
  constructor(host?: EventTarget) {
    super(isYouTubePlayerEvent, host)
  }
}

/** The one bridge the app uses; the player engine and the on-screen frame both find it here. */
export const youtubeBridge = new YouTubeBridge()
