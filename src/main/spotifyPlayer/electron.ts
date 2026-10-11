import { join } from 'node:path'
import { BrowserWindow, ipcMain, session, type WebContents } from 'electron'
import { SpotifyPlayerChannel, isSpotifyPlayerEvent, type SpotifyPlayerEvent } from '@shared/spotifyPlayer'
import type { SpotifyProvider } from '../providers/spotify/provider'
import { SpotifyPlayerHost, type PlayerWindow } from './host'

export const PLAYER_PARTITION = 'persist:spotify-player'

/** Nothing in either window needs camera, location, notifications and the like, so refuse every request. */
export function denyAllPermissions(target: Electron.Session): void {
  target.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  target.setPermissionCheckHandler(() => false)
}

/** Creates the hidden window that runs Spotify's player, with no access to the app's own bridge. */
function createPlayerWindow(onCreated: (contents: WebContents) => void): PlayerWindow {
  const window = new BrowserWindow({
    show: false,
    width: 480,
    height: 320,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      partition: PLAYER_PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Audio keeps playing while the window is hidden, and nobody clicks in it to allow it.
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  onCreated(window.webContents)

  return {
    load: async () => {
      if (process.env['ELECTRON_RENDERER_URL']) await window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/spotify-player.html`)
      else await window.loadFile(join(__dirname, '../renderer/spotify-player.html'))
    },
    send: (command) => window.webContents.send(SpotifyPlayerChannel.pageCommand, command),
    destroy: () => {
      if (!window.isDestroyed()) window.destroy()
    }
  }
}

/** Wires Spotify playback into the app: the hidden player, and the IPC the app window uses to control it. */
export function registerSpotifyPlayback(provider: SpotifyProvider): SpotifyPlayerHost {
  denyAllPermissions(session.fromPartition(PLAYER_PARTITION))
  let playerContents: WebContents | undefined

  const host = new SpotifyPlayerHost({
    createWindow: () => createPlayerWindow((contents) => (playerContents = contents)),
    startPlayback: (deviceId, trackId) => provider.startPlayback(deviceId, trackId),
    emit: (event: SpotifyPlayerEvent) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.webContents !== playerContents) window.webContents.send(SpotifyPlayerChannel.event, event)
      }
    }
  })

  const fromPlayerPage = (sender: WebContents): boolean => playerContents !== undefined && sender === playerContents

  ipcMain.handle(SpotifyPlayerChannel.pageGetToken, (event) => {
    if (!fromPlayerPage(event.sender)) throw new Error('Not allowed')
    return provider.getPlaybackToken()
  })
  ipcMain.on(SpotifyPlayerChannel.pageEvent, (event, payload: unknown) => {
    if (fromPlayerPage(event.sender) && isSpotifyPlayerEvent(payload)) host.handleEvent(payload)
  })

  // The app window is trusted, but its arguments are still checked.
  ipcMain.handle(SpotifyPlayerChannel.play, (_event, trackId: unknown) => {
    if (typeof trackId !== 'string') throw new Error('That is not a valid Spotify track.')
    return host.play(trackId)
  })
  ipcMain.handle(SpotifyPlayerChannel.pause, () => host.send({ type: 'pause' }))
  ipcMain.handle(SpotifyPlayerChannel.resume, () => host.send({ type: 'resume' }))
  ipcMain.handle(SpotifyPlayerChannel.seek, (_event, positionMs: unknown) => {
    if (typeof positionMs === 'number' && Number.isFinite(positionMs)) host.send({ type: 'seek', positionMs })
  })
  ipcMain.handle(SpotifyPlayerChannel.setVolume, (_event, volume: unknown) => {
    if (typeof volume === 'number' && Number.isFinite(volume)) host.send({ type: 'setVolume', volume })
  })

  return host
}
