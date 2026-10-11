import { ipcMain } from 'electron'
import { IpcChannel, type TurnTableApi } from '@shared/ipc'
import type { ProviderId } from '@shared/types'
import type { ProviderRegistry } from '../providers/registry'

/** The renderer-facing API, free of Electron so it can be tested directly. */
export function createApi(registry: ProviderRegistry): TurnTableApi {
  return {
    listProviders: async () => registry.listStatuses(),
    connectProvider: async (id) => registry.get(id).connect(),
    disconnectProvider: async (id) => registry.get(id).disconnect(),
    getSavedTracks: async (id, cursor) => registry.get(id).getSavedTracks(cursor)
  }
}

export function registerIpc(registry: ProviderRegistry): void {
  const api = createApi(registry)
  ipcMain.handle(IpcChannel.listProviders, () => api.listProviders())
  ipcMain.handle(IpcChannel.connectProvider, (_event, id: string) => api.connectProvider(id as ProviderId))
  ipcMain.handle(IpcChannel.disconnectProvider, (_event, id: string) => api.disconnectProvider(id as ProviderId))
  ipcMain.handle(IpcChannel.savedTracks, (_event, id: string, cursor?: string) =>
    api.getSavedTracks(id as ProviderId, cursor)
  )
}
