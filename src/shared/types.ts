export type ProviderId = 'spotify' | 'youtubeMusic' | 'tidal' | 'qobuz' | 'local'

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
  /** Signed in, but with an older grant that lacks permissions the app now needs (e.g. playback). */
  needsReauthorization?: boolean
  /** The service can be searched for tracks. */
  searchable?: boolean
  /** Tracks found by searching can be saved to, and removed from, the user's library on the service. */
  savable?: boolean
  /** An artist's albums, and each album's tracks, can be listed. */
  albums?: boolean
}

export interface Track {
  id: string
  providerId: ProviderId
  title: string
  artists: string[]
  /** The service's id for each of `artists`, in the same order, where it gave one ("" where it didn't). */
  artistIds?: string[]
  album?: string
  /** The service's id for `album`, when it gave one. */
  albumId?: string
  /** Position on its album, when known: disc first, then track. */
  discNumber?: number
  trackNumber?: number
  durationMs: number
  artworkUrl?: string
  /** Web page for the track on its own service, used to link back to it. */
  url?: string
  /** The format of the audio itself, when known (local files). */
  quality?: AudioQuality
  /** False when the service says this track can't be played in the app (for example, its owner turned off embedding). */
  playable?: boolean
  /** YouTube marks the video as made for kids. Its rules require tracking to be off for those, which the embedded player can't promise, so they are not played. */
  madeForKids?: boolean
  savedAt?: string
  /** In search results: whether the track is already in the user's library on its service. */
  saved?: boolean
}

/** An album, EP or single on one service. */
export interface Album {
  id: string
  providerId: ProviderId
  title: string
  artists: string[]
  /** The service's id for each of `artists`, in the same order ("" where it gave none). */
  artistIds?: string[]
  artworkUrl?: string
  /** As precise as the service gives it: "2003", "2003-05" or "2003-05-20". */
  releaseDate?: string
  kind?: 'album' | 'single' | 'ep' | 'compilation'
  trackCount?: number
  /** Web page for the album on its own service, used to link back to it. */
  url?: string
}

export interface AlbumPage {
  albums: Album[]
  /** Pass back to fetch the next page; absent on the last page. */
  nextCursor?: string
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
