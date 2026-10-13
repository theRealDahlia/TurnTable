import { describe, expect, it, vi } from 'vitest'
import type { OAuthSession } from '../src/main/auth/session'
import { createDefaultRegistry } from '../src/main/providers/registry'
import { TIDAL_SCOPES } from '../src/main/providers/tidal/config'
import { createTidalProvider } from '../src/main/providers/tidal/provider'

function setup(options: { granted?: boolean; clientId?: string | undefined } = {}) {
  const session = {
    isConnected: vi.fn().mockResolvedValue(true),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    hasScopes: vi.fn().mockResolvedValue(options.granted ?? true),
    getAccessToken: vi.fn().mockResolvedValue('token-1')
  }
  return { session, provider: createTidalProvider(session as unknown as OAuthSession, { clientId: () => ('clientId' in options ? options.clientId : 'client-1') }) }
}

describe('TIDAL sign-in', () => {
  it('describes itself as TIDAL, signing in with OAuth and playing through its own player', () => {
    expect(setup().provider.info).toMatchObject({ id: 'tidal', name: 'TIDAL', authKind: 'oauth-pkce', playback: 'sdk' })
  })

  it('hands sign-in, sign-out and connection state to its session', async () => {
    const { session, provider } = setup()
    await provider.connect()
    await provider.disconnect()
    expect(session.connect).toHaveBeenCalledOnce()
    expect(session.disconnect).toHaveBeenCalledOnce()
    await expect(provider.isConnected()).resolves.toBe(true)
  })

  it('asks to reconnect when the grant lacks something the app needs, and not otherwise', async () => {
    const missing = setup({ granted: false })
    await expect(missing.provider.needsReauthorization?.()).resolves.toBe(true)
    expect(missing.session.hasScopes).toHaveBeenCalledWith(TIDAL_SCOPES)

    await expect(setup().provider.needsReauthorization?.()).resolves.toBe(false)
  })

  it('never asks to reconnect when nobody is signed in', async () => {
    const { session, provider } = setup({ granted: false })
    session.isConnected.mockResolvedValue(false)
    await expect(provider.needsReauthorization?.()).resolves.toBe(false)
  })

  it('replaces its placeholder in the registry', async () => {
    const { provider } = setup()
    const registry = createDefaultRegistry({ tidal: provider })
    expect(registry.get('tidal')).toBe(provider)
    expect((await registry.listStatuses()).find((s) => s.id === 'tidal')).toMatchObject({ connected: true, needsReauthorization: false })
  })

  describe('playback sign-in for TIDAL\'s own player', () => {
    it('gives its player the app\'s client ID and a current token', async () => {
      const { provider, session } = setup()
      await expect(provider.getPlaybackAuth()).resolves.toEqual({ clientId: 'client-1', token: 'token-1' })
      expect(session.hasScopes).toHaveBeenCalledWith(['playback'])
    })

    it('asks to reconnect, and hands out no token, when the grant predates playback', async () => {
      const { provider, session } = setup({ granted: false })
      await expect(provider.getPlaybackAuth()).rejects.toThrow('Reconnect TIDAL to allow playback in Muze.')
      expect(session.getAccessToken).not.toHaveBeenCalled()
    })

    it('says how to set it up when there is no client ID', async () => {
      const { provider } = setup({ clientId: undefined })
      await expect(provider.getPlaybackAuth()).rejects.toThrow('MAIN_VITE_TIDAL_CLIENT_ID')
    })
  })
})
