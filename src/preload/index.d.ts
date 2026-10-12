import type { TurnTableApi } from '@shared/ipc'
import type { SpotifyPlayerApi } from '@shared/spotifyPlayer'
import type { QobuzStreamApi } from '@shared/qobuz'
import type { YouTubePlayerHostApi } from '@shared/youtubePlayer'

declare global {
  interface Window {
    turntable: TurnTableApi
    turntableSpotify: SpotifyPlayerApi
    turntableYouTube: YouTubePlayerHostApi
    turntableQobuz: QobuzStreamApi
  }
}
