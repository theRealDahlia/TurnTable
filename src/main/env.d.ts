/// <reference types="electron-vite/node" />

interface ImportMetaEnv {
  readonly MAIN_VITE_SPOTIFY_CLIENT_ID?: string
  readonly MAIN_VITE_YOUTUBE_CLIENT_ID?: string
  readonly MAIN_VITE_YOUTUBE_CLIENT_SECRET?: string
  readonly MAIN_VITE_TIDAL_CLIENT_ID?: string
  readonly MAIN_VITE_QOBUZ_APP_ID?: string
  readonly MAIN_VITE_QOBUZ_APP_SECRET?: string
}
