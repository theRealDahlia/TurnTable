import type { OAuthSession } from '../../auth/session'
import { SPOTIFY } from '../descriptors'
import { NotImplementedError, type MusicProvider } from '../types'

export function createSpotifyProvider(session: OAuthSession): MusicProvider {
  return {
    info: SPOTIFY,
    isConnected: () => session.isConnected(),
    connect: () => session.connect(),
    disconnect: () => session.disconnect(),
    getSavedTracks: async () => {
      throw new NotImplementedError('Spotify library')
    }
  }
}
