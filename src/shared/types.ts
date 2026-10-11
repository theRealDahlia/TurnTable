export type ProviderId = 'spotify' | 'youtubeMusic' | 'soundcloud' | 'qobuz' | 'local'

export type AuthKind = 'oauth-pkce' | 'credentials' | 'none'

/** How audio reaches the speakers for a provider. */
export type PlaybackKind = 'sdk' | 'embed' | 'stream' | 'file'

export interface AudioQuality {
  codec: string
  lossless: boolean
  bitrateKbps?: number
  sampleRateHz?: number
  bitDepth?: number
}

export interface ProviderDescriptor {
  id: ProviderId
  name: string
  authKind: AuthKind
  playback: PlaybackKind
  /** Best quality the service can deliver to a third-party app. */
  maxQuality: AudioQuality
}

export interface ProviderStatus extends ProviderDescriptor {
  connected: boolean
}

export interface Track {
  id: string
  providerId: ProviderId
  title: string
  artists: string[]
  album?: string
  durationMs: number
  artworkUrl?: string
  savedAt?: string
}

export interface TrackPage {
  tracks: Track[]
  /** Pass back to fetch the next page; absent on the last page. */
  nextCursor?: string
}

export interface TokenSet {
  accessToken: string
  refreshToken?: string
  /** Epoch milliseconds. */
  expiresAt: number
  scope?: string
}
