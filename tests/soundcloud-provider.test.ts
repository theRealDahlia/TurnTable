import { describe, expect, it, vi } from 'vitest'
import type { OAuthSession } from '../src/main/auth/session'
import { createDefaultRegistry } from '../src/main/providers/registry'
import { createSoundCloudProvider } from '../src/main/providers/soundcloud/provider'

function setup(options: { token?: () => Promise<string>; fetchResult?: () => Promise<Response> } = {}) {
  const session = {
    isConnected: vi.fn().mockResolvedValue(true),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getAccessToken: vi.fn(options.token ?? (async () => 'token-1'))
  }
  const fetchFn = vi.fn(options.fetchResult ?? (async () => new Response(null, { status: 200 })))
  const provider = createSoundCloudProvider(session as unknown as OAuthSession, { fetch: fetchFn as unknown as typeof fetch })
  return { session, fetchFn, provider }
}

describe('SoundCloud sign-in', () => {
  it('describes itself as SoundCloud, signing in with OAuth', () => {
    expect(setup().provider.info).toMatchObject({ id: 'soundcloud', name: 'SoundCloud', authKind: 'oauth-pkce' })
  })

  it('hands sign-in and connection state to its session', async () => {
    const { session, provider } = setup()
    await provider.connect()
    expect(session.connect).toHaveBeenCalledOnce()
    await expect(provider.isConnected()).resolves.toBe(true)
  })

  it("revokes this app's access on SoundCloud when disconnected, then forgets the sign-in", async () => {
    const { session, fetchFn, provider } = setup()

    await provider.disconnect()

    expect(fetchFn).toHaveBeenCalledExactlyOnceWith('https://api.soundcloud.com/disconnect', { method: 'POST', headers: { Authorization: 'OAuth token-1' } })
    expect(session.disconnect).toHaveBeenCalledOnce()
  })

  it.each([
    ['SoundCloud cannot be reached', { fetchResult: () => Promise.reject(new Error('offline')) }],
    ['SoundCloud refuses', { fetchResult: async () => new Response('no', { status: 400 }) }],
    ['the token cannot be had', { token: () => Promise.reject(new Error('Muze session expired')) }]
  ])('still disconnects when %s', async (_label, options) => {
    const { session, provider } = setup(options)
    await expect(provider.disconnect()).resolves.toBeUndefined()
    expect(session.disconnect).toHaveBeenCalledOnce()
  })

  it('replaces the placeholder in the registry', async () => {
    const { provider } = setup()
    const registry = createDefaultRegistry({ soundcloud: provider })
    expect(registry.get('soundcloud')).toBe(provider)
    expect((await registry.listStatuses()).find((s) => s.id === 'soundcloud')).toMatchObject({ connected: true })
  })
})
