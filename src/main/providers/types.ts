import type { ProviderDescriptor, TrackPage } from '@shared/types'

export interface MusicProvider {
  readonly info: ProviderDescriptor
  isConnected(): Promise<boolean>
  /** Runs the sign-in flow for this service. */
  connect(): Promise<void>
  disconnect(): Promise<void>
  getSavedTracks(cursor?: string): Promise<TrackPage>
}

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not implemented yet`)
    this.name = 'NotImplementedError'
  }
}
