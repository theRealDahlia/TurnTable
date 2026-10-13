import { join } from 'node:path'
import { BrowserWindow, ipcMain, session, type WebContents } from 'electron'
import { TidalPlayerChannel, isTidalPlayerEvent, type TidalPlayerEvent } from '@shared/tidalPlayer'
import type { TidalProvider } from '../providers/tidal/provider'
import { denyAllPermissions } from '../spotifyPlayer/electron'
import { TidalPlayerHost, type PlayerWindow } from './host'

export const TIDAL_PLAYER_PARTITION = 'persist:tidal-player'

/** Creates the hidden window that runs TIDAL's player, with no access to the app's own bridge. */
function createPlayerWindow(onCreated: (contents: WebContents) => void): PlayerWindow {
  const window = new BrowserWindow({
    show: false,
    width: 480,
    height: 320,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      partition: TIDAL_PLAYER_PARTITION,
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

  // While developing, the hidden page's problems are otherwise invisible: show its errors and refused requests.
  if (process.env['ELECTRON_RENDERER_URL']) {
    window.webContents.on('console-message', (event) => {
      const { level, message } = event as unknown as { level?: string | number; message?: string }
      if (level === 'error' || level === 'warning' || level === 2 || level === 3) console.warn('[tidal-player page]', message)
    })
    window.webContents.session.webRequest.onCompleted({ urls: ['https://*/*'] }, (details) => {
      if (details.statusCode >= 400) console.warn(`[tidal-player request] ${details.statusCode} ${details.method} ${details.url.split('?')[0]}`)
    })
  }

  return {
    load: async () => {
      if (process.env['ELECTRON_RENDERER_URL']) await window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/tidal-player.html`)
      else await window.loadFile(join(__dirname, '../renderer/tidal-player.html'))
    },
    send: (command) => window.webContents.send(TidalPlayerChannel.pageCommand, command),
    destroy: () => {
      if (!window.isDestroyed()) window.destroy()
    }
  }
}

/** Wires TIDAL playback into the app: the hidden player, and the IPC the app window uses to control it. */
export function registerTidalPlayback(provider: TidalProvider): TidalPlayerHost {
  denyAllPermissions(session.fromPartition(TIDAL_PLAYER_PARTITION))
  let playerContents: WebContents | undefined

  const host = new TidalPlayerHost({
    createWindow: () => createPlayerWindow((contents) => (playerContents = contents)),
    emit: (event: TidalPlayerEvent) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.webContents !== playerContents) window.webContents.send(TidalPlayerChannel.event, event)
      }
    }
  })

  const fromPlayerPage = (sender: WebContents): boolean => playerContents !== undefined && sender === playerContents

  ipcMain.handle(TidalPlayerChannel.pageGetAuth, (event) => {
    if (!fromPlayerPage(event.sender)) throw new Error('Not allowed')
    return provider.getPlaybackAuth()
  })
  ipcMain.on(TidalPlayerChannel.pageEvent, (event, payload: unknown) => {
    if (fromPlayerPage(event.sender) && isTidalPlayerEvent(payload)) host.handleEvent(payload)
  })

  // The app window is trusted, but its arguments are still checked.
  ipcMain.handle(TidalPlayerChannel.play, (_event, trackId: unknown) => {
    if (typeof trackId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(trackId)) throw new Error('That is not a valid TIDAL track.')
    return host.play(trackId)
  })
  ipcMain.handle(TidalPlayerChannel.pause, () => host.send({ type: 'pause' }))
  ipcMain.handle(TidalPlayerChannel.resume, () => host.send({ type: 'resume' }))
  ipcMain.handle(TidalPlayerChannel.seek, (_event, positionMs: unknown) => {
    if (typeof positionMs === 'number' && Number.isFinite(positionMs)) host.send({ type: 'seek', positionMs })
  })
  ipcMain.handle(TidalPlayerChannel.setVolume, (_event, volume: unknown) => {
    if (typeof volume === 'number' && Number.isFinite(volume)) host.send({ type: 'setVolume', volume })
  })

  return host
}
