import type { ProviderDescriptor } from '@shared/types'
import { NotImplementedError, type MusicProvider } from './types'

/** Stand-in used until a service's real integration is built. Replace per provider as each feature lands. */
export function createPlaceholderProvider(info: ProviderDescriptor): MusicProvider {
  return {
    info,
    isConnected: async () => false,
    connect: async () => {
      throw new NotImplementedError(`${info.name} sign-in`)
    },
    disconnect: async () => undefined,
    getSavedTracks: async () => {
      throw new NotImplementedError(`${info.name} library`)
    }
  }
}
