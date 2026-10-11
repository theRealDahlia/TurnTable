import { describe, expect, it, vi } from 'vitest'
import type { OAuthSession } from '../src/main/auth/session'
import { createDefaultRegistry } from '../src/main/providers/registry'
import { spotifyOAuthConfig } from '../src/main/providers/spotify/config'
import { createSpotifyProvider } from '../src/main/providers/spotify/provider'

describe('spotifyOAuthConfig', () => {
  it('targets Spotify with the least privilege the library needs', () => {
    const config = spotifyOAuthConfig('abc123')

    expect(config).toMatchObject({
      clientId: 'abc123',
      authorizeUrl: 'https://accounts.spotify.com/authorize',
      tokenUrl: 'https://accounts.spotify.com/api/token',
      scopes: ['user-library-read']
    })
  })

  it.each([undefined, ''])('explains how to fix a missing client id (%j)', (clientId) => {
    expect(() => spotifyOAuthConfig(clientId)).toThrow('MAIN_VITE_SPOTIFY_CLIENT_ID')
  })
})

describe('createSpotifyProvider', () => {
  const session = {
    isConnected: vi.fn().mockResolvedValue(true),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined)
  }
  const provider = createSpotifyProvider(session as unknown as OAuthSession)

  it('delegates sign-in state to the session', async () => {
    expect(provider.info.id).toBe('spotify')
    expect(await provider.isConnected()).toBe(true)
    await provider.connect()
    await provider.disconnect()
    expect(session.connect).toHaveBeenCalledOnce()
    expect(session.disconnect).toHaveBeenCalledOnce()
  })

  it('replaces the placeholder in the default registry and leaves the other services alone', async () => {
    const registry = createDefaultRegistry({ spotify: provider })

    expect(registry.get('spotify')).toBe(provider)
    await expect(registry.get('qobuz').connect()).rejects.toThrow('not implemented')
    expect((await registry.listStatuses()).find((s) => s.id === 'spotify')?.connected).toBe(true)
  })
})
