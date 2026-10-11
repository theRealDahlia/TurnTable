import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel, type TurnTableApi } from '@shared/ipc'

const api: TurnTableApi = {
  listProviders: () => ipcRenderer.invoke(IpcChannel.listProviders),
  connectProvider: (id) => ipcRenderer.invoke(IpcChannel.connectProvider, id),
  disconnectProvider: (id) => ipcRenderer.invoke(IpcChannel.disconnectProvider, id),
  getSavedTracks: (id, cursor) => ipcRenderer.invoke(IpcChannel.savedTracks, id, cursor)
}

contextBridge.exposeInMainWorld('turntable', api)
