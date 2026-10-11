import type { TurnTableApi } from '@shared/ipc'
import type { SpotifyPlayerApi } from '@shared/spotifyPlayer'

declare global {
  interface Window {
    turntable: TurnTableApi
    turntableSpotify: SpotifyPlayerApi
  }
}
