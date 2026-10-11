import type { ProviderId, ProviderStatus } from '@shared/types'
import { PROVIDER_DESCRIPTORS } from './descriptors'
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
        connected: await provider.isConnected(),
        needsReauthorization: (await provider.needsReauthorization?.()) ?? false
      }))
    )
  }
}

/** Real integrations replace the placeholder for their service; the rest stay placeholders. */
export function createDefaultRegistry(implementations: Partial<Record<ProviderId, MusicProvider>> = {}): ProviderRegistry {
  return new ProviderRegistry(
    PROVIDER_DESCRIPTORS.map((descriptor) => implementations[descriptor.id] ?? createPlaceholderProvider(descriptor))
  )
}
