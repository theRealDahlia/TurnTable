import type { TrackPage } from '@shared/types'
import { parseOffsetCursor } from '../cursor'
import { LOCAL } from '../descriptors'
import type { MusicProvider } from '../types'
import type { FolderStore } from './folderStore'
import type { LocalLibrary } from './library'

export interface LocalProviderDeps {
  folders: FolderStore
  library: LocalLibrary
  /** Asks the user for music folders; resolves to an empty list if they cancel. */
  pickFolders: () => Promise<string[]>
}

/** "Connecting" local files means choosing the folders to read; disconnecting forgets them. */
export function createLocalProvider({ folders, library, pickFolders }: LocalProviderDeps): MusicProvider {
  return {
    info: LOCAL,
    isConnected: async () => (await folders.list()).length > 0,

    async connect() {
      const picked = await pickFolders()
      if (picked.length > 0) await folders.add(picked)
    },

    async disconnect() {
      await folders.clear()
      library.reset()
    },

    async getSavedTracks(cursor): Promise<TrackPage> {
      const offset = parseOffsetCursor(cursor)
      if (offset === 0 || !library.isScanned) await library.refresh()
      return library.page(offset)
    }
  }
}
