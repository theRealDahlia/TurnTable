import { contextBridge, ipcRenderer } from 'electron'
import { describeError } from '@shared/errors'
import { SpotifyPlayerChannel, type PlayerPageBridge } from '@shared/spotifyPlayer'

/** What the hidden Spotify player page gets: a token, a way to report events, and commands. Nothing else. */
export function exposePlayerPageBridge(): void {
  const bridge: PlayerPageBridge = {
    getToken: async () => {
      try {
        return await ipcRenderer.invoke(SpotifyPlayerChannel.pageGetToken)
      } catch (error) {
        // The page shows this to the user, so drop the transport wrapping Electron adds to IPC errors.
        throw new Error(describeError(error), { cause: error })
      }
    },
    emit: (event) => ipcRenderer.send(SpotifyPlayerChannel.pageEvent, event),
    onCommand: (listener) => {
      ipcRenderer.on(SpotifyPlayerChannel.pageCommand, (_event, command) => listener(command))
    }
  }

  contextBridge.exposeInMainWorld('turntableSpotifyPage', bridge)
}
