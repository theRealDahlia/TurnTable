import { MediaRouter } from './MediaRouter'
import type { PlayerMedia } from './media'
import { SpotifyAudio } from './SpotifyAudio'
import { TidalAudio } from './TidalAudio'
import { youtubeBridge } from './YouTubeBridge'
import { YouTubeAudio } from './YouTubeAudio'

/** The app's audio source: a real <audio> element for local files, and each streaming service's own player. */
export function createDefaultMedia(): PlayerMedia {
  return new MediaRouter(new Audio(), {
    spotify: new SpotifyAudio(() => window.turntableSpotify),
    tidal: new TidalAudio(() => window.turntableTidal),
    youtube: new YouTubeAudio(youtubeBridge)
  })
}
