import { MediaRouter } from './MediaRouter'
import type { PlayerMedia } from './media'
import { QobuzAudio } from './QobuzAudio'
import { SpotifyAudio } from './SpotifyAudio'
import { soundcloudBridge } from './SoundCloudBridge'
import { SoundCloudAudio } from './SoundCloudAudio'
import { youtubeBridge } from './YouTubeBridge'
import { YouTubeAudio } from './YouTubeAudio'

/** The app's audio source: a real <audio> element for local files, and each streaming service's own player. */
export function createDefaultMedia(): PlayerMedia {
  return new MediaRouter(new Audio(), {
    spotify: new SpotifyAudio(() => window.turntableSpotify),
    youtube: new YouTubeAudio(youtubeBridge),
    soundcloud: new SoundCloudAudio(soundcloudBridge),
    qobuz: new QobuzAudio((trackId) => window.turntableQobuz.getStreamUrl(trackId))
  })
}
