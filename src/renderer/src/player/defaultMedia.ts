import { MediaRouter } from './MediaRouter'
import type { PlayerMedia } from './media'
import { SpotifyAudio } from './SpotifyAudio'
import { youtubeBridge } from './YouTubeBridge'
import { YouTubeAudio } from './YouTubeAudio'

/** The app's audio source: a real <audio> element for local files, and each streaming service's own player. */
export function createDefaultMedia(): PlayerMedia {
  return new MediaRouter(new Audio(), {
    spotify: new SpotifyAudio(() => window.turntableSpotify),
    youtube: new YouTubeAudio(youtubeBridge)
  })
}
