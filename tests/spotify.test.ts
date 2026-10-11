import { describe, expect, it, vi } from 'vitest'
import type { OAuthSession } from '../src/main/auth/session'
import { createDefaultRegistry } from '../src/main/providers/registry'
import { SPOTIFY_REDIRECT_PORT, spotifyOAuthConfig } from '../src/main/providers/spotify/config'
import { createSpotifyProvider } from '../src/main/providers/spotify/provider'

describe('spotifyOAuthConfig', () => {
  it('targets Spotify with only the scopes the library and playback need', () => {
    const config = spotifyOAuthConfig('abc123')

    expect(config).toMatchObject({
      clientId: 'abc123',
      authorizeUrl: 'https://accounts.spotify.com/authorize',
      tokenUrl: 'https://accounts.spotify.com/api/token',
      scopes: ['user-library-read', 'streaming', 'user-modify-playback-state'],
      loopbackPort: SPOTIFY_REDIRECT_PORT
    })
  })

  it('uses the redirect URI documented in the README', () => {
    expect(SPOTIFY_REDIRECT_PORT).toBe(43821)
  })

  it.each([undefined, ''])('explains how to fix a missing client id (%j)', (clientId) => {
    expect(() => spotifyOAuthConfig(clientId)).toThrow('MAIN_VITE_SPOTIFY_CLIENT_ID')
  })
})

describe('createSpotifyProvider', () => {
  const session = {
    hasScopes: vi.fn().mockResolvedValue(true),
    getAccessToken: vi.fn().mockResolvedValue('token-123'),
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

  describe('playback permission', () => {
    it('hands out an access token when the grant covers playback', async () => {
      session.hasScopes.mockResolvedValue(true)
      await expect(provider.getPlaybackToken()).resolves.toBe('token-123')
      expect(session.hasScopes).toHaveBeenCalledWith(['streaming', 'user-modify-playback-state'])
      expect(await provider.needsReauthorization?.()).toBe(false)
    })

    it('asks the user to reconnect when the grant predates playback, and gives out no token', async () => {
      session.hasScopes.mockResolvedValue(false)
      session.getAccessToken.mockClear()

      await expect(provider.getPlaybackToken()).rejects.toThrow('Reconnect Spotify')
      expect(session.getAccessToken).not.toHaveBeenCalled()
      expect(await provider.needsReauthorization?.()).toBe(true)
    })

    it('does not ask a signed-out user to reconnect', async () => {
      session.hasScopes.mockResolvedValue(false)
      session.isConnected.mockResolvedValueOnce(false)
      expect(await provider.needsReauthorization?.()).toBe(false)
    })

    it('reports reauthorization in the registry status', async () => {
      session.hasScopes.mockResolvedValue(false)
      const registry = createDefaultRegistry({ spotify: provider })
      const statuses = await registry.listStatuses()

      expect(statuses.find((s) => s.id === 'spotify')?.needsReauthorization).toBe(true)
      expect(statuses.find((s) => s.id === 'qobuz')?.needsReauthorization).toBe(false)
    })
  })
})
