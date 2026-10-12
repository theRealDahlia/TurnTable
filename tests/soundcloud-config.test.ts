import { describe, expect, it, vi } from 'vitest'
import { startLoopbackServer } from '../src/main/auth/loopback'
import { OAuthClient } from '../src/main/auth/oauth'
import { SOUNDCLOUD_REDIRECT_PORT, soundcloudOAuthConfig } from '../src/main/providers/soundcloud/config'

describe('soundcloudOAuthConfig', () => {
  it.each([
    [undefined, 'secret'],
    ['id', undefined],
    ['', 'secret'],
    ['id', ''],
    [undefined, undefined]
  ])('explains how to set up when the client id or secret is missing (%j, %j)', (id, secret) => {
    expect(() => soundcloudOAuthConfig(id, secret)).toThrow(/MAIN_VITE_SOUNDCLOUD_CLIENT_ID and MAIN_VITE_SOUNDCLOUD_CLIENT_SECRET/)
  })

  it("uses SoundCloud's endpoints over https, with the client secret and no scopes", () => {
    expect(soundcloudOAuthConfig('id', 'shh')).toEqual({
      clientId: 'id',
      clientSecret: 'shh',
      authorizeUrl: 'https://secure.soundcloud.com/authorize',
      tokenUrl: 'https://secure.soundcloud.com/oauth/token',
      scopes: [],
      loopbackPort: SOUNDCLOUD_REDIRECT_PORT
    })
  })

  it('uses a fixed loopback port, which is the one to register as the redirect URI', () => {
    expect(SOUNDCLOUD_REDIRECT_PORT).toBe(43823)
  })
})

describe('signing in without scopes', () => {
  it('leaves scope out of the authorization request, and sends the secret with the code exchange', async () => {
    const probe = await startLoopbackServer()
    const port = Number(new URL(probe.redirectUri).port)
    probe.close()

    const opened: URL[] = []
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: '' }), { status: 200 }))
    const client = new OAuthClient({
      openUrl: async (raw) => {
        const url = new URL(raw)
        opened.push(url)
        const redirect = new URL(url.searchParams.get('redirect_uri')!)
        redirect.searchParams.set('code', 'the-code')
        redirect.searchParams.set('state', url.searchParams.get('state')!)
        await fetch(redirect)
      },
      fetch: fetchMock as never,
      now: () => 0
    })

    const tokens = await client.authorize({ ...soundcloudOAuthConfig('id', 'shh'), loopbackPort: port })

    expect(tokens).toMatchObject({ accessToken: 'at', refreshToken: 'rt' })
    const authorize = opened[0]!
    expect(authorize.origin + authorize.pathname).toBe('https://secure.soundcloud.com/authorize')
    expect(authorize.searchParams.has('scope')).toBe(false)
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize.searchParams.get('client_id')).toBe('id')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = init.body as URLSearchParams
    expect(url).toBe('https://secure.soundcloud.com/oauth/token')
    expect(body.get('client_secret')).toBe('shh')
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('the-code')
    expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43,}$/)
  })

  it('still sends scope for services that have them', async () => {
    const probe = await startLoopbackServer()
    const port = Number(new URL(probe.redirectUri).port)
    probe.close()
    const opened: URL[] = []
    const client = new OAuthClient({
      openUrl: async (raw) => {
        const url = new URL(raw)
        opened.push(url)
        const redirect = new URL(url.searchParams.get('redirect_uri')!)
        redirect.searchParams.set('code', 'c')
        redirect.searchParams.set('state', url.searchParams.get('state')!)
        await fetch(redirect)
      },
      fetch: (async () => new Response(JSON.stringify({ access_token: 'at' }), { status: 200 })) as never,
      now: () => 0
    })
    await client.authorize({ clientId: 'id', authorizeUrl: 'https://a.example/authorize', tokenUrl: 'https://a.example/token', scopes: ['one', 'two'], loopbackPort: port })
    expect(opened[0]!.searchParams.get('scope')).toBe('one two')
  })
})

describe('refreshing a SoundCloud sign-in', () => {
  it("sends the secret, and keeps the new refresh token SoundCloud issues (they can be used once)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 'new-at', refresh_token: 'new-rt', expires_in: 3600 }), { status: 200 }))
    const client = new OAuthClient({ openUrl: async () => undefined, fetch: fetchMock as never, now: () => 1000 })

    const tokens = await client.refresh(soundcloudOAuthConfig('id', 'shh'), 'old-rt')

    expect(tokens).toMatchObject({ accessToken: 'new-at', refreshToken: 'new-rt' })
    const body = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams
    expect(Object.fromEntries(body)).toEqual({ grant_type: 'refresh_token', refresh_token: 'old-rt', client_id: 'id', client_secret: 'shh' })
  })
})
