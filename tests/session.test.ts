import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthClient, TokenRequestError, type OAuthConfig } from '../src/main/auth/oauth'
import { AuthRequiredError, OAuthSession } from '../src/main/auth/session'
import { TokenStore } from '../src/main/auth/tokenStore'

const config: OAuthConfig = {
  clientId: 'client-1',
  authorizeUrl: 'https://auth.example.com/authorize',
  tokenUrl: 'https://auth.example.com/token',
  scopes: ['read']
}

const plainEncryptor = {
  isAvailable: () => true,
  encrypt: (s: string) => Buffer.from(s),
  decrypt: (b: Buffer) => b.toString()
}

describe('OAuthSession', () => {
  let dir: string
  let store: TokenStore
  let now: number
  let oauth: { authorize: ReturnType<typeof vi.fn>; refresh: ReturnType<typeof vi.fn> }
  let session: OAuthSession

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'turntable-session-'))
    store = new TokenStore(join(dir, 'tokens.bin'), plainEncryptor)
    now = 1_000_000
    oauth = { authorize: vi.fn(), refresh: vi.fn() }
    session = new OAuthSession({
      providerId: 'spotify',
      serviceName: 'Spotify',
      config: () => config,
      oauth: oauth as unknown as OAuthClient,
      store,
      now: () => now
    })
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  const saveTokens = (overrides = {}) =>
    store.set('spotify', { accessToken: 'at', refreshToken: 'rt', expiresAt: now + 3_600_000, ...overrides })

  it('is disconnected until connect() succeeds, and persists the tokens', async () => {
    expect(await session.isConnected()).toBe(false)
    oauth.authorize.mockResolvedValue({ accessToken: 'new', refreshToken: 'rt', expiresAt: now + 1000 })

    await session.connect()

    expect(oauth.authorize).toHaveBeenCalledWith(config)
    expect(await session.isConnected()).toBe(true)
    expect(await store.get('spotify')).toMatchObject({ accessToken: 'new' })
  })

  it('stores nothing when sign-in fails', async () => {
    oauth.authorize.mockRejectedValue(new Error('Authorization failed: access_denied'))

    await expect(session.connect()).rejects.toThrow('access_denied')
    expect(await session.isConnected()).toBe(false)
  })

  it('disconnect() forgets the tokens', async () => {
    await saveTokens()
    await session.disconnect()
    expect(await session.isConnected()).toBe(false)
  })

  it('returns the stored token while it is comfortably valid', async () => {
    await saveTokens()
    await expect(session.getAccessToken()).resolves.toBe('at')
    expect(oauth.refresh).not.toHaveBeenCalled()
  })

  it('refreshes and persists a token that is about to expire', async () => {
    await saveTokens({ expiresAt: now + 30_000 })
    oauth.refresh.mockResolvedValue({ accessToken: 'fresh', refreshToken: 'rt2', expiresAt: now + 3_600_000 })

    await expect(session.getAccessToken()).resolves.toBe('fresh')
    expect(oauth.refresh).toHaveBeenCalledWith(config, 'rt')
    expect(await store.get('spotify')).toMatchObject({ accessToken: 'fresh', refreshToken: 'rt2' })
  })

  it('refreshes on demand even when the token looks valid', async () => {
    await saveTokens()
    oauth.refresh.mockResolvedValue({ accessToken: 'fresh', refreshToken: 'rt', expiresAt: now + 3_600_000 })

    await expect(session.getAccessToken({ forceRefresh: true })).resolves.toBe('fresh')
  })

  it('shares one refresh between concurrent callers', async () => {
    await saveTokens({ expiresAt: now - 1 })
    oauth.refresh.mockImplementation(
      async () => ({ accessToken: 'fresh', refreshToken: 'rt', expiresAt: now + 3_600_000 })
    )

    const results = await Promise.all([session.getAccessToken(), session.getAccessToken(), session.getAccessToken()])

    expect(results).toEqual(['fresh', 'fresh', 'fresh'])
    expect(oauth.refresh).toHaveBeenCalledTimes(1)
  })

  it('requires sign-in when nothing is stored', async () => {
    await expect(session.getAccessToken()).rejects.toBeInstanceOf(AuthRequiredError)
  })

  it('signs the user out when an expired token has no refresh token', async () => {
    await saveTokens({ expiresAt: now - 1, refreshToken: undefined })

    await expect(session.getAccessToken()).rejects.toBeInstanceOf(AuthRequiredError)
    expect(await session.isConnected()).toBe(false)
  })

  it.each([400, 401])('signs the user out when the refresh is rejected with %i', async (status) => {
    await saveTokens({ expiresAt: now - 1 })
    oauth.refresh.mockRejectedValue(new TokenRequestError(status))

    await expect(session.getAccessToken()).rejects.toThrow('Please reconnect')
    expect(await session.isConnected()).toBe(false)
  })

  it('keeps the tokens when the refresh fails for a transient reason', async () => {
    await saveTokens({ expiresAt: now - 1 })
    oauth.refresh.mockRejectedValueOnce(new TokenRequestError(503)).mockRejectedValueOnce(new TypeError('fetch failed'))

    await expect(session.getAccessToken()).rejects.toThrow('503')
    await expect(session.getAccessToken()).rejects.toThrow('fetch failed')
    expect(await session.isConnected()).toBe(true)
  })

  it('can refresh again after a failed refresh', async () => {
    await saveTokens({ expiresAt: now - 1 })
    oauth.refresh
      .mockRejectedValueOnce(new TokenRequestError(503))
      .mockResolvedValueOnce({ accessToken: 'fresh', refreshToken: 'rt', expiresAt: now + 3_600_000 })

    await expect(session.getAccessToken()).rejects.toThrow()
    await expect(session.getAccessToken()).resolves.toBe('fresh')
  })

  it('reports a missing client id when the user tries to connect, not before', async () => {
    const unconfigured = new OAuthSession({
      providerId: 'spotify',
      serviceName: 'Spotify',
      config: () => {
        throw new Error('Spotify is not set up')
      },
      oauth: oauth as unknown as OAuthClient,
      store,
      now: () => now
    })

    await expect(unconfigured.isConnected()).resolves.toBe(false)
    await expect(unconfigured.connect()).rejects.toThrow('not set up')
  })

  describe('scopes', () => {
    it('knows which scopes the stored grant covers', async () => {
      await saveTokens({ scope: 'user-library-read streaming' })
      expect(await session.hasScopes(['streaming'])).toBe(true)
      expect(await session.hasScopes(['user-library-read', 'streaming'])).toBe(true)
      expect(await session.hasScopes(['streaming', 'user-modify-playback-state'])).toBe(false)
    })

    it('treats a grant with no recorded scope, or no grant at all, as covering nothing', async () => {
      expect(await session.hasScopes(['streaming'])).toBe(false)
      await saveTokens({ scope: undefined })
      expect(await session.hasScopes(['streaming'])).toBe(false)
    })

    it('trivially covers an empty requirement', async () => {
      await saveTokens({ scope: undefined })
      expect(await session.hasScopes([])).toBe(true)
    })

    it('keeps the granted scope when a refresh response leaves it out', async () => {
      await saveTokens({ expiresAt: now - 1, scope: 'user-library-read streaming' })
      oauth.refresh.mockResolvedValue({ accessToken: 'fresh', refreshToken: 'rt', expiresAt: now + 3_600_000 })

      await session.getAccessToken()

      expect(await session.hasScopes(['streaming'])).toBe(true)
    })

    it('adopts the scope a refresh response reports', async () => {
      await saveTokens({ expiresAt: now - 1, scope: 'user-library-read' })
      oauth.refresh.mockResolvedValue({ accessToken: 'fresh', expiresAt: now + 3_600_000, scope: 'user-library-read streaming' })

      await session.getAccessToken()

      expect(await session.hasScopes(['streaming'])).toBe(true)
    })
  })
})
