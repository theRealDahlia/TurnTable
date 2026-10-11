import { describe, expect, it, vi } from 'vitest'
import { startLoopbackServer } from '../src/main/auth/loopback'
import { OAuthClient, TokenRequestError, type OAuthConfig } from '../src/main/auth/oauth'

const config: OAuthConfig = {
  clientId: 'client-1',
  authorizeUrl: 'https://auth.example.com/authorize',
  tokenUrl: 'https://auth.example.com/token',
  scopes: ['library.read', 'playback']
}

const tokenResponse = (body: object, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Plays the browser: reads the authorize URL and hits the redirect URI with a code. */
function fakeBrowser(options: { code?: string; stateOverride?: string } = {}) {
  const { code = 'auth-code', stateOverride } = options
  const opened: URL[] = []
  const openUrl = async (raw: string): Promise<void> => {
    const url = new URL(raw)
    opened.push(url)
    const redirect = new URL(url.searchParams.get('redirect_uri')!)
    redirect.searchParams.set('code', code)
    redirect.searchParams.set('state', stateOverride ?? url.searchParams.get('state')!)
    await fetch(redirect)
  }
  return { opened, openUrl }
}

describe('OAuthClient', () => {
  it('runs the PKCE flow and returns tokens', async () => {
    const browser = fakeBrowser()
    const fetchMock = vi.fn(async () =>
      tokenResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 100, scope: 'library.read' })
    )
    const client = new OAuthClient({ openUrl: browser.openUrl, fetch: fetchMock as never, now: () => 1_000 })

    const tokens = await client.authorize(config)

    expect(tokens).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresAt: 101_000, scope: 'library.read' })
    const authUrl = browser.opened[0]!
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authUrl.searchParams.get('scope')).toBe('library.read playback')

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = init.body as URLSearchParams
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('auth-code')
    expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43,}$/)
  })

  it('uses the fixed loopback port when the service needs a pre-registered redirect URI', async () => {
    const probe = await startLoopbackServer()
    const port = Number(new URL(probe.redirectUri).port)
    probe.close()

    const browser = fakeBrowser()
    const fetchMock = vi.fn(async () => tokenResponse({ access_token: 'at', expires_in: 100 }))
    const client = new OAuthClient({ openUrl: browser.openUrl, fetch: fetchMock as never, now: () => 0 })

    await client.authorize({ ...config, loopbackPort: port })

    expect(browser.opened[0]!.searchParams.get('redirect_uri')).toBe(`http://127.0.0.1:${port}/callback`)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.body as URLSearchParams).get('redirect_uri')).toBe(`http://127.0.0.1:${port}/callback`)
  })

  it('rejects a callback whose state does not match', async () => {
    const browser = fakeBrowser({ stateOverride: 'forged' })
    const fetchMock = vi.fn()
    const client = new OAuthClient({ openUrl: browser.openUrl, fetch: fetchMock as never, now: () => 0 })

    await expect(client.authorize(config)).rejects.toThrow('state')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces token endpoint failures without leaking the response body', async () => {
    const browser = fakeBrowser()
    const fetchMock = vi.fn(async () => tokenResponse({ error: 'invalid_grant', secret: 'x' }, 400))
    const client = new OAuthClient({ openUrl: browser.openUrl, fetch: fetchMock as never, now: () => 0 })

    const error = await client.authorize(config).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(TokenRequestError)
    expect((error as TokenRequestError).status).toBe(400)
    expect((error as Error).message).not.toContain('secret')
  })

  it('rejects a token response with no access token', async () => {
    const browser = fakeBrowser()
    const client = new OAuthClient({
      openUrl: browser.openUrl,
      fetch: (async () => tokenResponse({})) as never,
      now: () => 0
    })

    await expect(client.authorize(config)).rejects.toThrow('access token')
  })

  it('refreshes tokens and keeps the old refresh token when none is returned', async () => {
    const fetchMock = vi.fn(async () => tokenResponse({ access_token: 'new', expires_in: 60 }))
    const client = new OAuthClient({ openUrl: async () => undefined, fetch: fetchMock as never, now: () => 0 })

    const tokens = await client.refresh(config, 'old-rt')

    expect(tokens).toMatchObject({ accessToken: 'new', refreshToken: 'old-rt', expiresAt: 60_000 })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.body as URLSearchParams).get('grant_type')).toBe('refresh_token')
  })

  describe('token endpoint failures', () => {
    const failWith = async (response: Response) => {
      const client = new OAuthClient({ openUrl: async () => undefined, fetch: (async () => response) as never, now: () => 0 })
      return (await client.refresh(config, 'rt').catch((e: unknown) => e)) as TokenRequestError
    }

    it("pass on the service's own explanation", async () => {
      const error = await failWith(tokenResponse({ error: 'invalid_request', error_description: 'client_secret is missing.' }, 400))
      expect(error).toBeInstanceOf(TokenRequestError)
      expect(error.status).toBe(400)
      expect(error.detail).toBe('client_secret is missing.')
      expect(error.message).toBe('Token request failed with status 400: client_secret is missing.')
    })

    it('fall back to the error code when there is no description', async () => {
      expect((await failWith(tokenResponse({ error: 'invalid_grant' }, 400))).message).toBe('Token request failed with status 400: invalid_grant')
    })

    it('clean up and cap the text', async () => {
      const error = await failWith(tokenResponse({ error_description: `bad\u0000\n${'x'.repeat(500)}` }, 400))
      expect(error.detail).not.toMatch(/\p{Cc}/u)
      expect(error.detail?.length).toBeLessThanOrEqual(200)
    })

    it.each([
      ['not JSON', new Response('<html>', { status: 502 })],
      ['JSON without an explanation', tokenResponse({ other: 1 }, 502)],
      ['a non-text explanation', tokenResponse({ error_description: { a: 1 } }, 502)],
      ['an empty explanation', tokenResponse({ error_description: '  ' }, 502)]
    ])('just report the status for %s', async (_label, response) => {
      const error = await failWith(response)
      expect(error.message).toBe('Token request failed with status 502')
      expect(error.detail).toBeUndefined()
    })
  })
})
