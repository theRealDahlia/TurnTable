import type { TrackPage } from '@shared/types'
import type { OAuthSession } from '../../auth/session'
import { SOUNDCLOUD } from '../descriptors'
import { NotImplementedError, type MusicProvider } from '../types'
import { SOUNDCLOUD_API } from './config'

export type FetchFn = typeof fetch

export interface SoundCloudProviderOptions {
  fetch?: FetchFn
}

export function createSoundCloudProvider(session: OAuthSession, options: SoundCloudProviderOptions = {}): MusicProvider {
  const { fetch: fetchFn = fetch } = options

  return {
    info: SOUNDCLOUD,
    isConnected: () => session.isConnected(),
    connect: () => session.connect(),

    async disconnect() {
      // Revoking this app's tokens on SoundCloud's side (POST /disconnect, which leaves the user's own sign-in to
      // soundcloud.com alone) is good manners, but it must never stop the user disconnecting.
      try {
        const token = await session.getAccessToken()
        await fetchFn(`${SOUNDCLOUD_API}/disconnect`, { method: 'POST', headers: { Authorization: `OAuth ${token}` } })
      } catch {
        // Offline, or the token had already lapsed: the local sign-out below is what counts.
      }
      await session.disconnect()
    },

    getSavedTracks: (): Promise<TrackPage> => Promise.reject(new NotImplementedError('SoundCloud library'))
  }
}
