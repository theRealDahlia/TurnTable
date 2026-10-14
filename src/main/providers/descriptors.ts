import type { ProviderDescriptor } from '@shared/types'

export const SPOTIFY: ProviderDescriptor = {
  id: 'spotify',
  name: 'Spotify',
  authKind: 'oauth-pkce',
  playback: 'sdk',
  maxQuality: { codec: 'ogg-vorbis', lossless: false, bitrateKbps: 320 }
}

export const YOUTUBE_MUSIC: ProviderDescriptor = {
  id: 'youtubeMusic',
  name: 'YouTube',
  authKind: 'oauth-pkce',
  playback: 'embed',
  maxQuality: { codec: 'opus', lossless: false, bitrateKbps: 256 }
}

/** TIDAL streams lossless FLAC, up to 24-bit / 192 kHz on its highest tier; its own player plays it, and the user signs in on TIDAL's page. */
export const TIDAL: ProviderDescriptor = {
  id: 'tidal',
  name: 'TIDAL',
  authKind: 'oauth-pkce',
  playback: 'sdk',
  maxQuality: { codec: 'flac', lossless: true, sampleRateHz: 192000, bitDepth: 24 }
}

export const LOCAL: ProviderDescriptor = {
  id: 'local',
  name: 'Local files',
  authKind: 'none',
  playback: 'file',
  maxQuality: { codec: 'flac', lossless: true, sampleRateHz: 192000, bitDepth: 24 }
}

export const PROVIDER_DESCRIPTORS: ProviderDescriptor[] = [
  SPOTIFY,
  YOUTUBE_MUSIC,
  TIDAL,
  LOCAL
]
