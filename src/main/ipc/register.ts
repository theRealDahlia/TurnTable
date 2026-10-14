import { ipcMain } from 'electron'
import { IpcChannel, type Credentials, type TurnTableApi } from '@shared/ipc'
import type { ProviderId, TrackPage } from '@shared/types'
import type { ProviderRegistry } from '../providers/registry'
import { shareInFlight } from './singleFlight'
import { APP_NAME } from '@shared/app'

const MAX_QUERY_LENGTH = 200
const MAX_TRACK_ID_LENGTH = 100

/** Everything from the renderer is untrusted, so check its shape before it reaches a service. */
function checkQuery(query: unknown): string {
  if (typeof query !== 'string') throw new Error('Type something to search for.')
  const trimmed = query.trim()
  if (!trimmed) throw new Error('Type something to search for.')
  if (trimmed.length > MAX_QUERY_LENGTH) throw new Error(`Searches can be at most ${MAX_QUERY_LENGTH} characters.`)
  return trimmed
}

function checkTrackId(trackId: unknown): string {
  if (typeof trackId !== 'string' || !trackId || trackId.length > MAX_TRACK_ID_LENGTH) throw new Error('That is not a valid track.')
  return trackId
}

function checkCatalogId(value: unknown, what: 'artist' | 'album'): string {
  if (typeof value !== 'string' || !value || value.length > MAX_TRACK_ID_LENGTH) throw new Error(`That is not a valid ${what}.`)
  return value
}

const MAX_CREDENTIAL_LENGTH = 256

/** The user's own sign-in details arrive from the renderer, so check their shape, and never put them in a message. */
function checkCredentials(name: string, value: unknown): Credentials {
  const entry = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const { username, password } = entry
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    throw new Error(`Enter your ${name} email and password.`)
  }
  if (username.length > MAX_CREDENTIAL_LENGTH || password.length > MAX_CREDENTIAL_LENGTH) throw new Error(`That ${name} email or password is too long.`)
  return { username: username.trim(), password }
}

function checkCursor(cursor: unknown): string | undefined {
  if (cursor === undefined) return undefined
  if (typeof cursor !== 'string' || cursor.length > 500) throw new Error('Invalid library cursor')
  return cursor
}

/** A service that can't do something says so plainly, instead of failing with a TypeError. */
function unsupported(name: string, what: string): Error {
  return new Error(`${name} doesn't support ${what} in ${APP_NAME} yet.`)
}

/** The renderer-facing API, free of Electron so it can be tested directly. */
export function createApi(registry: ProviderRegistry): TurnTableApi {
  // Library pages cost API quota, so identical requests made at the same moment (React's development
  // double-run, a double-clicked Retry) share one fetch.
  const pagesInFlight = new Map<string, Promise<TrackPage>>()

  return {
    listProviders: async () => registry.listStatuses(),
    connectProvider: async (id, credentials) => {
      const provider = registry.get(id)
      // Only a service that signs in with the user's own details is given them; the others sign in in a browser.
      if (provider.info.authKind === 'credentials') await provider.connect(checkCredentials(provider.info.name, credentials))
      else await provider.connect()
    },
    disconnectProvider: async (id) => registry.get(id).disconnect(),
    getSavedTracks: (id, cursor) =>
      shareInFlight(pagesInFlight, `${id}\u0000${cursor ?? ''}`, async () => registry.get(id).getSavedTracks(cursor)),
    searchTracks: async (id, query, cursor) => {
      const provider = registry.get(id)
      const text = checkQuery(query)
      const next = checkCursor(cursor)
      if (!provider.search) throw unsupported(provider.info.name, 'search')
      return provider.search(text, next)
    },
    saveTrack: async (id, trackId) => {
      const provider = registry.get(id)
      const checked = checkTrackId(trackId)
      if (!provider.saveTrack) throw unsupported(provider.info.name, 'saving songs')
      await provider.saveTrack(checked)
    },
    unsaveTrack: async (id, trackId) => {
      const provider = registry.get(id)
      const checked = checkTrackId(trackId)
      if (!provider.unsaveTrack) throw unsupported(provider.info.name, 'removing saved songs')
      await provider.unsaveTrack(checked)
    },
    getArtistAlbums: async (id, artistId, cursor) => {
      const provider = registry.get(id)
      const checked = checkCatalogId(artistId, 'artist')
      const next = checkCursor(cursor)
      if (!provider.getArtistAlbums) throw unsupported(provider.info.name, 'albums')
      return provider.getArtistAlbums(checked, next)
    },
    getAlbumTracks: async (id, albumId, cursor) => {
      const provider = registry.get(id)
      const checked = checkCatalogId(albumId, 'album')
      const next = checkCursor(cursor)
      if (!provider.getAlbumTracks) throw unsupported(provider.info.name, 'albums')
      return provider.getAlbumTracks(checked, next)
    }
  }
}

export function registerIpc(registry: ProviderRegistry): void {
  const api = createApi(registry)
  ipcMain.handle(IpcChannel.listProviders, () => api.listProviders())
  ipcMain.handle(IpcChannel.connectProvider, (_event, id: string, credentials?: Credentials) => api.connectProvider(id as ProviderId, credentials))
  ipcMain.handle(IpcChannel.disconnectProvider, (_event, id: string) => api.disconnectProvider(id as ProviderId))
  ipcMain.handle(IpcChannel.savedTracks, (_event, id: string, cursor?: string) =>
    api.getSavedTracks(id as ProviderId, cursor)
  )
  ipcMain.handle(IpcChannel.searchTracks, (_event, id: string, query: string, cursor?: string) =>
    api.searchTracks(id as ProviderId, query, cursor)
  )
  ipcMain.handle(IpcChannel.saveTrack, (_event, id: string, trackId: string) => api.saveTrack(id as ProviderId, trackId))
  ipcMain.handle(IpcChannel.unsaveTrack, (_event, id: string, trackId: string) => api.unsaveTrack(id as ProviderId, trackId))
  ipcMain.handle(IpcChannel.artistAlbums, (_event, id: string, artistId: string, cursor?: string) => api.getArtistAlbums(id as ProviderId, artistId, cursor))
  ipcMain.handle(IpcChannel.albumTracks, (_event, id: string, albumId: string, cursor?: string) => api.getAlbumTracks(id as ProviderId, albumId, cursor))
}
