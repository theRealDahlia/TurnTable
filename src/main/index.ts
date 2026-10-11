import { join } from 'node:path'
import { app, BrowserWindow, safeStorage, shell } from 'electron'
import { OAuthClient } from './auth/oauth'
import { OAuthSession } from './auth/session'
import { TokenStore } from './auth/tokenStore'
import { registerIpc } from './ipc/register'
import { spotifyOAuthConfig } from './providers/spotify/config'
import { createSpotifyProvider } from './providers/spotify/provider'
import { createDefaultRegistry } from './providers/registry'

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'TurnTable',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  window.once('ready-to-show', () => window.show())

  // Never let the app window navigate away or spawn windows; external links open in the default browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  if (process.env['ELECTRON_RENDERER_URL']) void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

function createRegistry(): ReturnType<typeof createDefaultRegistry> {
  const store = new TokenStore(join(app.getPath('userData'), 'tokens.bin'), {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data)
  })
  const oauth = new OAuthClient({
    openUrl: async (url) => {
      if (!url.startsWith('https://')) throw new Error('Refusing to open a non-https sign-in URL')
      await shell.openExternal(url)
    },
    fetch,
    now: Date.now
  })
  const spotify = new OAuthSession({
    providerId: 'spotify',
    serviceName: 'Spotify',
    config: () => spotifyOAuthConfig(import.meta.env.MAIN_VITE_SPOTIFY_CLIENT_ID),
    oauth,
    store,
    now: Date.now
  })
  return createDefaultRegistry({ spotify: createSpotifyProvider(spotify) })
}

app.whenReady().then(() => {
  registerIpc(createRegistry())
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
