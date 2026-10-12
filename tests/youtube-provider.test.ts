import { describe, expect, it, vi } from 'vitest'
import type { OAuthSession } from '../src/main/auth/session'
import { createYouTubeProvider } from '../src/main/providers/youtube/provider'

function setup(options: { fetchResult?: () => Promise<Response>; token?: () => Promise<string> } = {}) {
  const session = {
    isConnected: vi.fn().mockResolvedValue(true),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getAccessToken: vi.fn(options.token ?? (async () => 'token-1'))
  }
  const fetchFn = vi.fn(options.fetchResult ?? (async () => new Response(null, { status: 200 })))
  return { session, fetchFn, provider: createYouTubeProvider(session as unknown as OAuthSession, { fetch: fetchFn as unknown as typeof fetch }) }
}

describe('YouTube Music sign-in', () => {
  it('describes itself as YouTube Music', () => {
    expect(setup().provider.info).toMatchObject({ id: 'youtubeMusic', name: 'YouTube Music', authKind: 'oauth-pkce' })
  })

  it('hands sign-in, sign-out and connection state to its session', async () => {
    const { session, provider } = setup()

    await provider.connect()
    await provider.disconnect()

    expect(session.connect).toHaveBeenCalledOnce()
    expect(session.disconnect).toHaveBeenCalledOnce()
    await expect(provider.isConnected()).resolves.toBe(true)
  })

  it("revokes Muze's access at Google when disconnected, then forgets the sign-in", async () => {
    const { session, fetchFn, provider } = setup()

    await provider.disconnect()

    expect(fetchFn).toHaveBeenCalledExactlyOnceWith('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'token=token-1'
    })
    expect(session.disconnect).toHaveBeenCalledOnce()
  })

  it.each([
    ['Google cannot be reached', { fetchResult: () => Promise.reject(new Error('offline')) }],
    ['Google refuses', { fetchResult: async () => new Response('no', { status: 400 }) }],
    ['the token cannot be had', { token: () => Promise.reject(new Error('YouTube Music session expired')) }]
  ])('still disconnects when %s', async (_label, options) => {
    const { session, provider } = setup(options)
    await expect(provider.disconnect()).resolves.toBeUndefined()
    expect(session.disconnect).toHaveBeenCalledOnce()
  })
})
