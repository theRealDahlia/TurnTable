import { contextBridge, ipcRenderer } from 'electron'
import { describeError } from '@shared/errors'
import { TidalPlayerChannel, type TidalPageBridge } from '@shared/tidalPlayer'

/** What the hidden TIDAL player page gets: its credentials, a way to report events, and commands. Nothing else. */
export function exposeTidalPageBridge(): void {
  const bridge: TidalPageBridge = {
    getAuth: async () => {
      try {
        return await ipcRenderer.invoke(TidalPlayerChannel.pageGetAuth)
      } catch (error) {
        // The page shows this to the user, so drop the transport wrapping Electron adds to IPC errors.
        throw new Error(describeError(error), { cause: error })
      }
    },
    emit: (event) => ipcRenderer.send(TidalPlayerChannel.pageEvent, event),
    onCommand: (listener) => {
      ipcRenderer.on(TidalPlayerChannel.pageCommand, (_event, command) => listener(command))
    }
  }

  contextBridge.exposeInMainWorld('turntableTidalPage', bridge)
}
