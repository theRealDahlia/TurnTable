import type { ProviderId, ProviderStatus, TrackPage } from './types'

export const IpcChannel = {
  listProviders: 'providers:list',
  connectProvider: 'providers:connect',
  disconnectProvider: 'providers:disconnect',
  savedTracks: 'library:saved-tracks',
  searchTracks: 'library:search',
  saveTrack: 'library:save',
  unsaveTrack: 'library:unsave'
} as const

/** The API the preload script exposes to the renderer as `window.turntable`. */
export interface TurnTableApi {
  listProviders(): Promise<ProviderStatus[]>
  connectProvider(id: ProviderId): Promise<void>
  disconnectProvider(id: ProviderId): Promise<void>
  getSavedTracks(id: ProviderId, cursor?: string): Promise<TrackPage>
  /** Searches one service's catalog. Pass the previous page's `nextCursor` for more results. */
  searchTracks(id: ProviderId, query: string, cursor?: string): Promise<TrackPage>
  /** Adds a track to the user's library on its service. */
  saveTrack(id: ProviderId, trackId: string): Promise<void>
  /** Removes a track from the user's library on its service. */
  unsaveTrack(id: ProviderId, trackId: string): Promise<void>
}
