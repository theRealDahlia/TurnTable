import type { TrackPage } from '@shared/types'
import type { OAuthSession } from '../../auth/session'
import { YOUTUBE_MUSIC } from '../descriptors'
import { NotImplementedError, type MusicProvider } from '../types'

export function createYouTubeProvider(session: OAuthSession): MusicProvider {
  return {
    info: YOUTUBE_MUSIC,
    isConnected: () => session.isConnected(),
    connect: () => session.connect(),
    disconnect: () => session.disconnect(),
    getSavedTracks: (): Promise<TrackPage> => Promise.reject(new NotImplementedError('YouTube Music library'))
  }
}
