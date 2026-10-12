import { isSoundCloudPlayerEvent, type SoundCloudPlayerCommand, type SoundCloudPlayerEvent } from '@shared/soundcloudPlayer'
import { EmbedBridge, type EmbedChannel } from './EmbedBridge'

/** What `SoundCloudAudio` needs from the frame that runs SoundCloud's player. */
export type SoundCloudChannel = EmbedChannel<SoundCloudPlayerCommand, SoundCloudPlayerEvent>

/** The bridge to SoundCloud's player frame. */
export class SoundCloudBridge extends EmbedBridge<SoundCloudPlayerCommand, SoundCloudPlayerEvent> {
  constructor(host?: EventTarget) {
    super(isSoundCloudPlayerEvent, host)
  }
}

/** The one bridge the app uses; the player engine and the on-screen frame both find it here. */
export const soundcloudBridge = new SoundCloudBridge()
