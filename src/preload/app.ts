import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel, type TurnTableApi } from '@shared/ipc'
import { YouTubePlayerChannel, type YouTubePlayerHostApi } from '@shared/youtubePlayer'
import { SpotifyPlayerChannel, type SpotifyPlayerApi, type SpotifyPlayerEvent } from '@shared/spotifyPlayer'

/** What the app window gets: the library API, the Spotify playback controls, and where YouTube's player page lives. */
export function exposeAppApi(): void {
  const api: TurnTableApi = {
    listProviders: () => ipcRenderer.invoke(IpcChannel.listProviders),
    connectProvider: (id) => ipcRenderer.invoke(IpcChannel.connectProvider, id),
    disconnectProvider: (id) => ipcRenderer.invoke(IpcChannel.disconnectProvider, id),
    getSavedTracks: (id, cursor) => ipcRenderer.invoke(IpcChannel.savedTracks, id, cursor)
  }

  const spotify: SpotifyPlayerApi = {
    play: (trackId) => ipcRenderer.invoke(SpotifyPlayerChannel.play, trackId),
    pause: () => ipcRenderer.invoke(SpotifyPlayerChannel.pause),
    resume: () => ipcRenderer.invoke(SpotifyPlayerChannel.resume),
    seek: (positionMs) => ipcRenderer.invoke(SpotifyPlayerChannel.seek, positionMs),
    setVolume: (volume) => ipcRenderer.invoke(SpotifyPlayerChannel.setVolume, volume),
    onEvent: (listener) => {
      const handler = (_event: unknown, payload: SpotifyPlayerEvent): void => listener(payload)
      ipcRenderer.on(SpotifyPlayerChannel.event, handler)
      return () => void ipcRenderer.removeListener(SpotifyPlayerChannel.event, handler)
    }
  }

  const youtube: YouTubePlayerHostApi = {
    getPlayerUrl: () => ipcRenderer.invoke(YouTubePlayerChannel.playerUrl)
  }

  contextBridge.exposeInMainWorld('turntable', api)
  contextBridge.exposeInMainWorld('turntableSpotify', spotify)
  contextBridge.exposeInMainWorld('turntableYouTube', youtube)
}
