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
  name: 'YouTube Music',
  authKind: 'oauth-pkce',
  playback: 'embed',
  maxQuality: { codec: 'opus', lossless: false, bitrateKbps: 256 }
}

/** SoundCloud's API streams AAC at up to 160 kbps; it plays in SoundCloud's own player, so it is an embed. */
export const SOUNDCLOUD: ProviderDescriptor = {
  id: 'soundcloud',
  name: 'SoundCloud',
  authKind: 'oauth-pkce',
  playback: 'embed',
  maxQuality: { codec: 'aac', lossless: false, bitrateKbps: 160 }
}

/** Qobuz streams lossless FLAC up to 24-bit / 192 kHz to subscribers; it signs in with the user's own account. */
export const QOBUZ: ProviderDescriptor = {
  id: 'qobuz',
  name: 'Qobuz',
  authKind: 'credentials',
  playback: 'stream',
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
  SOUNDCLOUD,
  QOBUZ,
  LOCAL
]
