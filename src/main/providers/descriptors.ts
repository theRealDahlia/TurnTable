import type { ProviderDescriptor } from '@shared/types'

export const SPOTIFY: ProviderDescriptor = {
  id: 'spotify',
  name: 'Spotify',
  authKind: 'oauth-pkce',
  playback: 'sdk',
  maxQuality: { codec: 'ogg-vorbis', lossless: false, bitrateKbps: 320 }
}

export const PROVIDER_DESCRIPTORS: ProviderDescriptor[] = [
  SPOTIFY,
  {
    id: 'youtubeMusic',
    name: 'YouTube Music',
    authKind: 'oauth-pkce',
    playback: 'embed',
    maxQuality: { codec: 'opus', lossless: false, bitrateKbps: 256 }
  },
  {
    id: 'soundcloud',
    name: 'SoundCloud',
    authKind: 'oauth-pkce',
    playback: 'stream',
    maxQuality: { codec: 'aac', lossless: false, bitrateKbps: 256 }
  },
  {
    id: 'qobuz',
    name: 'Qobuz',
    authKind: 'credentials',
    playback: 'stream',
    maxQuality: { codec: 'flac', lossless: true, sampleRateHz: 192000, bitDepth: 24 }
  },
  {
    id: 'local',
    name: 'Local files',
    authKind: 'none',
    playback: 'file',
    maxQuality: { codec: 'flac', lossless: true, sampleRateHz: 192000, bitDepth: 24 }
  }
]
