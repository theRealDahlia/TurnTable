import { describe, expect, it, vi } from 'vitest'
import { AuthRequiredError } from '../src/main/auth/session'
import type { TokenStore } from '../src/main/auth/tokenStore'
import { qobuzApp } from '../src/main/providers/qobuz/config'
import { createQobuzProvider } from '../src/main/providers/qobuz/provider'
import { QobuzSession, tierOf } from '../src/main/providers/qobuz/session'
import { createDefaultRegistry } from '../src/main/providers/registry'
import type { TokenSet } from '../src/shared/types'

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })

const login = (rights: Record<string, boolean> = { hires_streaming: true, lossless_streaming: true, lossy_streaming: true }) => ({
  user_auth_token: 'user-token-123',
  user: { id: 1, credential: { parameters: rights } }
})

function setup(responses: Response[] = []) {
  const saved = new Map<string, TokenSet>()
  const store = {
    get: vi.fn(async (id: string) => saved.get(id)),
    set: vi.fn(async (id: string, tokens: TokenSet) => void saved.set(id, tokens)),
    delete: vi.fn(async (id: string) => void saved.delete(id))
  }
  const fetchFn = vi.fn()
  for (const response of responses) fetchFn.mockResolvedValueOnce(response)
  const session = new QobuzSession({
    app: () => ({ appId: 'app-id-1', appSecret: 'app-secret-1' }),
    store: store as unknown as TokenStore,
    fetch: fetchFn as unknown as typeof fetch,
    now: () => 1_000
  })
  return { session, store, fetchFn, saved }
}

describe('qobuzApp', () => {
  it.each([
    [undefined, 'secret'],
    ['id', undefined],
    ['', 'secret'],
    ['id', ''],
    [undefined, undefined]
  ])('explains how to set up when the application ID or secret is missing (%j, %j)', (id, secret) => {
    expect(() => qobuzApp(id, secret)).toThrow(/MAIN_VITE_QOBUZ_APP_ID and MAIN_VITE_QOBUZ_APP_SECRET/)
  })

  it('has no built-in defaults, since Qobuz issues them to each developer and forbids sharing them', () => {
    expect(qobuzApp('id', 'secret')).toEqual({ appId: 'id', appSecret: 'secret' })
  })
})

describe('tierOf', () => {
  it.each([
    [{ hires_streaming: true, lossless_streaming: true, lossy_streaming: true }, 'hires'],
    [{ hires_streaming: false, lossless_streaming: true, lossy_streaming: true }, 'lossless'],
    [{ hires_streaming: false, lossless_streaming: false, lossy_streaming: true }, 'lossy'],
    [{ hires_streaming: false, lossless_streaming: false, lossy_streaming: false }, 'none'],
    [{}, 'none']
  ])('reads %j as %s', (rights, tier) => {
    expect(tierOf(login(rights))).toBe(tier)
  })

  it.each([{}, { user: {} }, { user: { credential: {} } }, { user: { credential: { parameters: { hires_streaming: 'yes' } } } }])('reads %j as none', (response) => {
    expect(tierOf(response)).toBe('none')
  })
})

describe('QobuzSession sign-in', () => {
  it('sends the account\'s details to Qobuz over https, in the request body and never in the address', async () => {
    const { session, fetchFn } = setup([json(login())])

    await session.signIn('me@example.com', 'p@ss word&=')

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://www.qobuz.com/api.json/0.2/user/login')
    expect(url).not.toContain('me@example.com')
    expect(url).not.toContain('ss')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'X-App-Id': 'app-id-1', 'Content-Type': 'application/x-www-form-urlencoded' })
    const body = init.body as URLSearchParams
    expect(body.get('username')).toBe('me@example.com')
    expect(body.get('password')).toBe('p@ss word&=')
    expect(body.get('app_id')).toBe('app-id-1')
  })

  it('never sends the application secret to Qobuz\'s login', async () => {
    const { session, fetchFn } = setup([json(login())])
    await session.signIn('me@example.com', 'pw')
    expect(JSON.stringify(fetchFn.mock.calls[0])).not.toContain('app-secret-1')
  })

  it('keeps only the token and what the subscription allows, not the password', async () => {
    const { session, store, saved } = setup([json(login({ lossless_streaming: true, lossy_streaming: true }))])

    await session.signIn('me@example.com', 'hunter2')

    expect(saved.get('qobuz')).toEqual({ accessToken: 'user-token-123', expiresAt: 1_000 + 365 * 24 * 60 * 60 * 1000, scope: 'lossless' })
    expect(JSON.stringify(store.set.mock.calls)).not.toContain('hunter2')
    expect(JSON.stringify(store.set.mock.calls)).not.toContain('me@example.com')
    await expect(session.isConnected()).resolves.toBe(true)
    await expect(session.tier()).resolves.toBe('lossless')
    await expect(session.getToken()).resolves.toBe('user-token-123')
  })

  it('records an account that cannot stream, so it can browse but not play', async () => {
    const { session } = setup([json(login({}))])
    await session.signIn('me@example.com', 'pw')
    await expect(session.tier()).resolves.toBe('none')
    await expect(session.isConnected()).resolves.toBe(true)
  })

  it("shows Qobuz's own message when it refuses the account, without repeating what was sent", async () => {
    const { session, saved } = setup([json({ code: 401, status: 'error', message: 'Invalid username/email and password combination' }, { status: 401 })])
    const error = (await session.signIn('me@example.com', 'hunter2').catch((e: unknown) => e)) as Error
    expect(error.message).toBe('Qobuz: Invalid username/email and password combination')
    expect(error.message).not.toContain('hunter2')
    expect(error.message).not.toContain('me@example.com')
    expect(saved.size).toBe(0)
  })

  it.each([400, 401, 403])('says in plain words that status %i was a refusal when Qobuz gives no message', async (status) => {
    const { session } = setup([new Response(null, { status })])
    await expect(session.signIn('a@b.c', 'pw')).rejects.toThrow('Qobuz did not accept that email and password.')
  })

  it('reports other failures with their status', async () => {
    const { session } = setup([new Response('<html>', { status: 503 })])
    await expect(session.signIn('a@b.c', 'pw')).rejects.toThrow('Qobuz sign-in failed with status 503')
  })

  it('cleans up the message before it is shown', async () => {
    const { session } = setup([json({ message: `bad\u0000\n${'x'.repeat(500)}` }, { status: 400 })])
    const error = (await session.signIn('a@b.c', 'pw').catch((e: unknown) => e)) as Error
    expect(error.message).not.toMatch(/\p{Cc}/u)
    expect(error.message.length).toBeLessThan(260)
  })

  it.each([
    ['no token', {}],
    ['an empty token', { user_auth_token: '' }],
    ['a token that is not text', { user_auth_token: 5 }]
  ])('does not count a response with %s as signed in', async (_label, body) => {
    const { session, saved } = setup([json(body)])
    await expect(session.signIn('a@b.c', 'pw')).rejects.toThrow('Qobuz did not return a sign-in')
    expect(saved.size).toBe(0)
  })

  it('does not reach Qobuz at all without the application ID and secret', async () => {
    const fetchFn = vi.fn()
    const session = new QobuzSession({
      app: () => qobuzApp(undefined, undefined),
      store: { get: vi.fn(), set: vi.fn(), delete: vi.fn() } as unknown as TokenStore,
      fetch: fetchFn as unknown as typeof fetch,
      now: () => 0
    })
    await expect(session.signIn('a@b.c', 'pw')).rejects.toThrow('Qobuz is not set up')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('QobuzSession after sign-in', () => {
  it('signs out by forgetting the token', async () => {
    const { session, saved } = setup([json(login())])
    await session.signIn('a@b.c', 'pw')
    await session.signOut()
    expect(saved.size).toBe(0)
    await expect(session.isConnected()).resolves.toBe(false)
    await expect(session.tier()).resolves.toBe('none')
  })

  it('asks the user to sign in when there is no token', async () => {
    const { session } = setup()
    await expect(session.getToken()).rejects.toBeInstanceOf(AuthRequiredError)
    await expect(session.getToken()).rejects.toThrow('Qobuz session expired')
  })

  it('ends the sign-in when Qobuz refuses the token', async () => {
    const { session, saved } = setup([json(login())])
    await session.signIn('a@b.c', 'pw')
    await expect(session.expire()).rejects.toBeInstanceOf(AuthRequiredError)
    expect(saved.size).toBe(0)
  })
})

describe('Qobuz provider', () => {
  it('signs in with the credentials it is given, and refuses to without them', async () => {
    const { session, fetchFn } = setup([json(login())])
    const provider = createQobuzProvider(session)
    expect(provider.info).toMatchObject({ id: 'qobuz', name: 'Qobuz', authKind: 'credentials' })

    await expect(provider.connect()).rejects.toThrow('Enter your Qobuz email and password.')
    expect(fetchFn).not.toHaveBeenCalled()

    await provider.connect({ username: 'a@b.c', password: 'pw' })
    await expect(provider.isConnected()).resolves.toBe(true)
    await provider.disconnect()
    await expect(provider.isConnected()).resolves.toBe(false)
  })

  it('replaces the placeholder in the registry', async () => {
    const { session } = setup()
    const registry = createDefaultRegistry({ qobuz: createQobuzProvider(session) })
    expect((await registry.listStatuses()).find((s) => s.id === 'qobuz')).toMatchObject({ connected: false, searchable: false })
  })
})
