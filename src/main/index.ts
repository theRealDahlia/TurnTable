import { join } from 'node:path'
import { app, BrowserWindow, components, dialog, nativeTheme, protocol, safeStorage, session, shell } from 'electron'
import { MEDIA_SCHEME } from '@shared/media'
import { createMediaHandler } from './media/handler'
import { OAuthClient } from './auth/oauth'
import { OAuthSession } from './auth/session'
import { TokenStore } from './auth/tokenStore'
import { registerIpc } from './ipc/register'
import { spotifyOAuthConfig } from './providers/spotify/config'
import { FolderStore } from './providers/local/folderStore'
import { LocalLibrary } from './providers/local/library'
import { readArtwork, readFileMetadata } from './providers/local/metadata'
import { createLocalProvider } from './providers/local/provider'
import { createSpotifyProvider, type SpotifyProvider } from './providers/spotify/provider'
import { FileRateLimitStore, RateLimitGate } from './providers/spotify/rateLimit'
import { denyAllPermissions, registerSpotifyPlayback } from './spotifyPlayer/electron'
import { registerTidalPlayback } from './tidalPlayer/electron'
import { registerEmbedPlayers } from './embedPlayer/electron'
import { createDefaultRegistry } from './providers/registry'
import { youtubeOAuthConfig } from './providers/youtube/config'
import { createYouTubeProvider } from './providers/youtube/provider'
import { tidalOAuthConfig } from './providers/tidal/config'
import { createTidalProvider, type TidalProvider } from './providers/tidal/provider'
import { qobuzApp } from './providers/qobuz/config'
import { registerQobuzStreaming } from './providers/qobuz/electron'
import { createQobuzProvider, type QobuzProvider } from './providers/qobuz/provider'
import { QobuzSession } from './providers/qobuz/session'
import { APP_NAME } from '@shared/app'

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: APP_NAME,
    // Matches the page background, so there is no white flash before the first paint.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#08070e' : '#f6f4fb',
    // On macOS the title bar is hidden and the traffic lights sit inside the sidebar, like a native app.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 19 } } : {}),
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

/** Must run before the app is ready; `stream` is what lets <audio> seek through large files. */
protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

function createRegistry(): { registry: ReturnType<typeof createDefaultRegistry>; library: LocalLibrary; spotify: SpotifyProvider; tidal: TidalProvider; qobuz: QobuzProvider } {
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
  const spotifySession = new OAuthSession({
    providerId: 'spotify',
    serviceName: 'Spotify',
    config: () => spotifyOAuthConfig(import.meta.env.MAIN_VITE_SPOTIFY_CLIENT_ID),
    oauth,
    store,
    now: Date.now
  })
  const youtubeSession = new OAuthSession({
    providerId: 'youtubeMusic',
    serviceName: 'YouTube',
    config: () => youtubeOAuthConfig(import.meta.env.MAIN_VITE_YOUTUBE_CLIENT_ID, import.meta.env.MAIN_VITE_YOUTUBE_CLIENT_SECRET),
    oauth,
    store,
    now: Date.now
  })

  const tidalSession = new OAuthSession({
    providerId: 'tidal',
    serviceName: 'TIDAL',
    config: () => tidalOAuthConfig(import.meta.env.MAIN_VITE_TIDAL_CLIENT_ID),
    oauth,
    store,
    now: Date.now
  })

  const qobuzCredentials = (): ReturnType<typeof qobuzApp> => qobuzApp(import.meta.env.MAIN_VITE_QOBUZ_APP_ID, import.meta.env.MAIN_VITE_QOBUZ_APP_SECRET)
  const qobuzSession = new QobuzSession({
    app: qobuzCredentials,
    store,
    fetch,
    now: Date.now
  })

  const folders = new FolderStore(join(app.getPath('userData'), 'local-folders.json'))
  const library = new LocalLibrary({ folders, readMetadata: readFileMetadata })
  const local = createLocalProvider({
    folders,
    library,
    pickFolders: async () => {
      const options = { title: 'Choose your music folders', properties: ['openDirectory' as const, 'multiSelections' as const] }
      const parent = BrowserWindow.getFocusedWindow()
      const { canceled, filePaths } = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
      return canceled ? [] : filePaths
    }
  })

  // Spotify's "wait until..." survives restarts, so reopening the app can't keep calling a service that said stop.
  const gate = new RateLimitGate({ store: new FileRateLimitStore(join(app.getPath('userData'), 'spotify-rate-limit.json')), now: Date.now })
  // Half a second between requests: a library of thousands is fetched at a steady pace, never in a burst.
  const spotify = createSpotifyProvider(spotifySession, { gate, minIntervalMs: 500 })
  const qobuz = createQobuzProvider(qobuzSession, { app: qobuzCredentials })
  const tidal = createTidalProvider(tidalSession, { minIntervalMs: 300, clientId: () => import.meta.env.MAIN_VITE_TIDAL_CLIENT_ID })
  return {
    registry: createDefaultRegistry({ spotify, local, youtubeMusic: createYouTubeProvider(youtubeSession), tidal, qobuz }),
    library,
    spotify,
    tidal,
    qobuz
  }
}

app.whenReady().then(async () => {
  // Widevine arrives via Chromium's component updater; Spotify playback waits on it, but the app must not.
  await components.whenReady().catch((error: unknown) => console.warn('Widevine is not available:', error))
  denyAllPermissions(session.defaultSession)

  const { registry, library, spotify, tidal, qobuz } = createRegistry()
  registerSpotifyPlayback(spotify)
  registerTidalPlayback(tidal)
  registerQobuzStreaming(qobuz)
  const embedPlayers = registerEmbedPlayers()
  app.on('will-quit', embedPlayers.close)
  protocol.handle(MEDIA_SCHEME, createMediaHandler({ resolve: (id) => library.resolve(id), readArtwork }))
  registerIpc(registry)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
