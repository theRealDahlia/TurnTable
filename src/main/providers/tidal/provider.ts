import type { TrackPage } from '@shared/types'
import { APP_NAME } from '@shared/app'
import type { OAuthSession } from '../../auth/session'
import { TIDAL } from '../descriptors'
import { NotImplementedError, type MusicProvider } from '../types'
import { TIDAL_SCOPES } from './config'

/** The user signed in before the app asked for what it needs now, so their grant doesn't cover it. */
export class TidalPermissionError extends Error {
  constructor() {
    super(`Reconnect TIDAL to allow everything ${APP_NAME} needs.`)
    this.name = 'TidalPermissionError'
  }
}

export function createTidalProvider(session: OAuthSession): MusicProvider {
  return {
    info: TIDAL,
    isConnected: () => session.isConnected(),
    connect: () => session.connect(),
    disconnect: () => session.disconnect(),

    async needsReauthorization() {
      return (await session.isConnected()) && !(await session.hasScopes(TIDAL_SCOPES))
    },

    async getSavedTracks(): Promise<TrackPage> {
      throw new NotImplementedError('Reading your TIDAL library')
    }
  }
}
