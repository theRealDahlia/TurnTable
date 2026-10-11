import type { ProviderId, ProviderStatus } from '@shared/types'
import { createPlaceholderProvider } from './placeholder'
import type { MusicProvider } from './types'

export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, MusicProvider>()

  constructor(providers: MusicProvider[]) {
    for (const provider of providers) this.providers.set(provider.info.id, provider)
  }

  /** Throws for ids it does not know, since ids arrive from the untrusted renderer. */
  get(id: string): MusicProvider {
    const provider = this.providers.get(id as ProviderId)
    if (!provider) throw new Error(`Unknown provider: ${id}`)
    return provider
  }

  async listStatuses(): Promise<ProviderStatus[]> {
    return Promise.all(
      [...this.providers.values()].map(async (provider) => ({
        ...provider.info,
        connected: await provider.isConnected()
      }))
    )
  }
}

export function createDefaultRegistry(): ProviderRegistry {
  return new ProviderRegistry([
    createPlaceholderProvider({
      id: 'spotify',
      name: 'Spotify',
      authKind: 'oauth-pkce',
      playback: 'sdk',
      maxQuality: { codec: 'ogg-vorbis', lossless: false, bitrateKbps: 320 }
    }),
    createPlaceholderProvider({
      id: 'youtubeMusic',
      name: 'YouTube Music',
      authKind: 'oauth-pkce',
      playback: 'embed',
      maxQuality: { codec: 'opus', lossless: false, bitrateKbps: 256 }
    }),
    createPlaceholderProvider({
      id: 'soundcloud',
      name: 'SoundCloud',
      authKind: 'oauth-pkce',
      playback: 'stream',
      maxQuality: { codec: 'aac', lossless: false, bitrateKbps: 256 }
    }),
    createPlaceholderProvider({
      id: 'qobuz',
      name: 'Qobuz',
      authKind: 'credentials',
      playback: 'stream',
      maxQuality: { codec: 'flac', lossless: true, sampleRateHz: 192000, bitDepth: 24 }
    }),
    createPlaceholderProvider({
      id: 'local',
      name: 'Local files',
      authKind: 'none',
      playback: 'file',
      maxQuality: { codec: 'flac', lossless: true, sampleRateHz: 192000, bitDepth: 24 }
    })
  ])
}
