import { MediaRouter } from './MediaRouter'
import type { PlayerMedia } from './media'
import { SpotifyAudio } from './SpotifyAudio'

/** The app's audio source: a real <audio> element for local files, and Spotify's player for Spotify tracks. */
export function createDefaultMedia(): PlayerMedia {
  return new MediaRouter(new Audio(), new SpotifyAudio(() => window.turntableSpotify))
}
