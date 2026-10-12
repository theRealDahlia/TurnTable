import type { Credentials } from '@shared/ipc'
import type { ProviderDescriptor, TrackPage } from '@shared/types'

export interface MusicProvider {
  readonly info: ProviderDescriptor
  isConnected(): Promise<boolean>
  /** Runs the sign-in flow for this service; services that sign in with the user's own credentials are given them. */
  connect(credentials?: Credentials): Promise<void>
  disconnect(): Promise<void>
  getSavedTracks(cursor?: string): Promise<TrackPage>
  /** True when connected with a grant that is missing permissions the app needs; the user must reconnect. */
  needsReauthorization?(): Promise<boolean>
  /** Searches the service's catalog; tracks say whether they are already saved. */
  search?(query: string, cursor?: string): Promise<TrackPage>
  /** Adds a track to the user's library on the service. */
  saveTrack?(trackId: string): Promise<void>
  /** Removes a track from the user's library on the service. */
  unsaveTrack?(trackId: string): Promise<void>
}

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not implemented yet`)
    this.name = 'NotImplementedError'
  }
}
