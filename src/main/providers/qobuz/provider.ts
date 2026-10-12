import type { TrackPage } from '@shared/types'
import type { Credentials } from '@shared/ipc'
import { QOBUZ } from '../descriptors'
import { NotImplementedError, type MusicProvider } from '../types'
import type { QobuzSession } from './session'

export function createQobuzProvider(session: QobuzSession): MusicProvider {
  return {
    info: QOBUZ,
    isConnected: () => session.isConnected(),

    async connect(credentials?: Credentials) {
      if (!credentials) throw new Error('Enter your Qobuz email and password.')
      await session.signIn(credentials.username, credentials.password)
    },

    disconnect: () => session.signOut(),

    getSavedTracks: (): Promise<TrackPage> => Promise.reject(new NotImplementedError('Qobuz library'))
  }
}
