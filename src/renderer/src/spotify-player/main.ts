import { SPOTIFY_ERRORS, type PlayerPageBridge } from '@shared/spotifyPlayer'
import { startPlayerPage, type SpotifyNamespace } from './page'

declare global {
  interface Window {
    turntableSpotifyPage: PlayerPageBridge
    onSpotifyWebPlaybackSDKReady?: () => void
    Spotify?: SpotifyNamespace
  }
}

const bridge = window.turntableSpotifyPage

// Spotify's script calls this once it has loaded, so it must exist before the script is added.
window.onSpotifyWebPlaybackSDKReady = () => {
  if (window.Spotify) startPlayerPage(bridge, window.Spotify)
}

const script = document.createElement('script')
script.src = 'https://sdk.scdn.co/spotify-player.js'
script.onerror = () => bridge.emit({ type: 'error', kind: 'initialization', message: SPOTIFY_ERRORS.loadFailed })
document.head.append(script)
