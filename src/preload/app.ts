import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel, type TurnTableApi } from '@shared/ipc'
import { QobuzChannel, type QobuzStreamApi } from '@shared/qobuz'
import { YouTubePlayerChannel, type YouTubePlayerHostApi } from '@shared/youtubePlayer'
import { TidalPlayerChannel, type TidalPlayerApi, type TidalPlayerEvent } from '@shared/tidalPlayer'
import { SpotifyPlayerChannel, type SpotifyPlayerApi, type SpotifyPlayerEvent } from '@shared/spotifyPlayer'

/** What the app window gets: the library API, the Spotify playback controls, and where each embedded player's page lives. */
export function exposeAppApi(): void {
  const api: TurnTableApi = {
    listProviders: () => ipcRenderer.invoke(IpcChannel.listProviders),
    connectProvider: (id, credentials) => ipcRenderer.invoke(IpcChannel.connectProvider, id, credentials),
    disconnectProvider: (id) => ipcRenderer.invoke(IpcChannel.disconnectProvider, id),
    getSavedTracks: (id, cursor) => ipcRenderer.invoke(IpcChannel.savedTracks, id, cursor),
    searchTracks: (id, query, cursor) => ipcRenderer.invoke(IpcChannel.searchTracks, id, query, cursor),
    saveTrack: (id, trackId) => ipcRenderer.invoke(IpcChannel.saveTrack, id, trackId),
    unsaveTrack: (id, trackId) => ipcRenderer.invoke(IpcChannel.unsaveTrack, id, trackId),
    getArtistAlbums: (id, artistId, cursor) => ipcRenderer.invoke(IpcChannel.artistAlbums, id, artistId, cursor),
    getAlbumTracks: (id, albumId, cursor) => ipcRenderer.invoke(IpcChannel.albumTracks, id, albumId, cursor)
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

  const tidal: TidalPlayerApi = {
    play: (trackId) => ipcRenderer.invoke(TidalPlayerChannel.play, trackId),
    pause: () => ipcRenderer.invoke(TidalPlayerChannel.pause),
    resume: () => ipcRenderer.invoke(TidalPlayerChannel.resume),
    seek: (positionMs) => ipcRenderer.invoke(TidalPlayerChannel.seek, positionMs),
    setVolume: (volume) => ipcRenderer.invoke(TidalPlayerChannel.setVolume, volume),
    onEvent: (listener) => {
      const handler = (_event: unknown, payload: TidalPlayerEvent): void => listener(payload)
      ipcRenderer.on(TidalPlayerChannel.event, handler)
      return () => void ipcRenderer.removeListener(TidalPlayerChannel.event, handler)
    }
  }

  const youtube: YouTubePlayerHostApi = {
    getPlayerUrl: () => ipcRenderer.invoke(YouTubePlayerChannel.playerUrl)
  }

  const qobuz: QobuzStreamApi = {
    getStreamUrl: (trackId) => ipcRenderer.invoke(QobuzChannel.streamUrl, trackId)
  }

  contextBridge.exposeInMainWorld('turntable', api)
  contextBridge.exposeInMainWorld('turntableSpotify', spotify)
  contextBridge.exposeInMainWorld('turntableTidal', tidal)
  contextBridge.exposeInMainWorld('turntableYouTube', youtube)
  contextBridge.exposeInMainWorld('turntableQobuz', qobuz)
}
