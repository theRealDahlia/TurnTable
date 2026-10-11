import type { ProviderId, ProviderStatus, TrackPage } from './types'

export const IpcChannel = {
  listProviders: 'providers:list',
  connectProvider: 'providers:connect',
  disconnectProvider: 'providers:disconnect',
  savedTracks: 'library:saved-tracks'
} as const

/** The API the preload script exposes to the renderer as `window.turntable`. */
export interface TurnTableApi {
  listProviders(): Promise<ProviderStatus[]>
  connectProvider(id: ProviderId): Promise<void>
  disconnectProvider(id: ProviderId): Promise<void>
  getSavedTracks(id: ProviderId, cursor?: string): Promise<TrackPage>
}
