import { describe, expect, it, vi } from 'vitest'
import type { OAuthSession } from '../src/main/auth/session'
import { REQUIRED_SCOPES } from '../src/main/providers/spotify/config'
import { LibraryPermissionError, createSpotifyProvider } from '../src/main/providers/spotify/provider'
import { RateLimitGate } from '../src/main/providers/spotify/rateLimit'

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })
const empty = (status = 200): Response => new Response(null, { status })

const ID_A = '4iV5W9uYEdYUVa79Axb7Rh'
const ID_B = '1301WleyT98MSxVHPZCA6M'

const item = (id: string | null, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Song ${id}`,
  duration_ms: 200_000,
  artists: [{ name: 'Foo Fighters' }],
  album: { name: 'Wasting Light', images: [{ url: 'https://img/300', width: 300 }, { url: 'https://img/64', width: 64 }] },
  external_urls: { spotify: `https://open.spotify.com/track/${id}` },
  ...overrides
})
const found = (items: unknown[], next: string | null = null) => json({ tracks: { items, next } })

function setup(responses: Response[], options: { scopes?: boolean; gate?: RateLimitGate } = {}) {
  const session = {
    getAccessToken: vi.fn().mockResolvedValue('token-1'),
    disconnect: vi.fn().mockResolvedValue(undefined),
    hasScopes: vi.fn().mockResolvedValue(options.scopes ?? true),
    isConnected: vi.fn().mockResolvedValue(true),
    connect: vi.fn()
  }
  const fetchFn = vi.fn()
  for (const response of responses) fetchFn.mockResolvedValueOnce(response)
  const provider = createSpotifyProvider(session as unknown as OAuthSession, {
    fetch: fetchFn as unknown as typeof fetch,
    sleep: vi.fn().mockResolvedValue(undefined),
    random: () => 0,
    gate: options.gate
  })
  return { session, fetchFn, provider }
}

const requested = (fetchFn: ReturnType<typeof vi.fn>, call = 0): URL => new URL((fetchFn.mock.calls[call] as [string])[0])
const methodOf = (fetchFn: ReturnType<typeof vi.fn>, call = 0): string | undefined => (fetchFn.mock.calls[call] as [string, RequestInit])[1].method

describe('Spotify search', () => {
  it('searches tracks, ten at a time, with the access token', async () => {
    const { provider, fetchFn } = setup([found([item(ID_A)]), json([false])])

    await provider.search!('foo fighters')

    const url = requested(fetchFn)
    expect(`${url.origin}${url.pathname}`).toBe('https://api.spotify.com/v1/search')
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'foo fighters', type: 'track', limit: '10', offset: '0' })
    expect((fetchFn.mock.calls[0] as [string, RequestInit])[1].headers).toEqual({ Authorization: 'Bearer token-1' })
  })

  it('keeps the characters of the query intact, including ones that matter in a URL', async () => {
    const { provider, fetchFn } = setup([found([]), json([])])
    await provider.search!('  AC/DC & "Back in Black" artist:ac+dc  ')
    expect(requested(fetchFn).searchParams.get('q')).toBe('AC/DC & "Back in Black" artist:ac+dc')
  })

  it('maps results to tracks, with no save date and the saved flag from the library', async () => {
    const { provider } = setup([found([item(ID_A), item(ID_B)]), json([true, false])])

    const page = await provider.search!('foo')

    expect(page.tracks).toEqual([
      {
        id: ID_A,
        providerId: 'spotify',
        title: `Song ${ID_A}`,
        artists: ['Foo Fighters'],
        album: 'Wasting Light',
        durationMs: 200_000,
        artworkUrl: 'https://img/300',
        url: `https://open.spotify.com/track/${ID_A}`,
        savedAt: undefined,
        saved: true
      },
      expect.objectContaining({ id: ID_B, saved: false })
    ])
  })

  it('asks which results are saved in one request, using the track URIs', async () => {
    const { provider, fetchFn } = setup([found([item(ID_A), item(ID_B)]), json([false, false])])

    await provider.search!('foo')

    expect(fetchFn).toHaveBeenCalledTimes(2)
    const contains = requested(fetchFn, 1)
    expect(`${contains.origin}${contains.pathname}`).toBe('https://api.spotify.com/v1/me/library/contains')
    expect(contains.searchParams.get('uris')).toBe(`spotify:track:${ID_A},spotify:track:${ID_B}`)
  })

  it('treats a missing answer as not saved', async () => {
    const { provider } = setup([found([item(ID_A), item(ID_B)]), json([true])])
    const { tracks } = await provider.search!('foo')
    expect(tracks.map((t) => t.saved)).toEqual([true, false])
  })

  it('skips results that cannot be played, and asks only about the rest', async () => {
    const { provider, fetchFn } = setup([found([null, item(null), item(ID_A, { is_local: true }), item(ID_B)]), json([true])])

    const { tracks } = await provider.search!('foo')

    expect(tracks.map((t) => t.id)).toEqual([ID_B])
    expect(requested(fetchFn, 1).searchParams.get('uris')).toBe(`spotify:track:${ID_B}`)
  })

  it('makes no second request when nothing matched', async () => {
    const { provider, fetchFn } = setup([found([])])
    expect(await provider.search!('zzzzzz')).toEqual({ tracks: [], nextCursor: undefined })
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('copes with a response without a tracks section', async () => {
    const { provider } = setup([json({})])
    expect(await provider.search!('foo')).toEqual({ tracks: [], nextCursor: undefined })
  })

  it('pages by offset', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => item(`${i}`.padStart(22, 'a')))
    const { provider, fetchFn } = setup([found(ten, 'https://api.spotify.com/v1/search?offset=10'), json(Array(10).fill(false)), found([item(ID_A)]), json([false])])

    const first = await provider.search!('foo')
    expect(first.nextCursor).toBe('10')
    const second = await provider.search!('foo', first.nextCursor)

    expect(requested(fetchFn, 2).searchParams.get('offset')).toBe('10')
    expect(second.nextCursor).toBeUndefined()
  })

  it('stops paging at the end of what Spotify will return', async () => {
    const { provider, fetchFn } = setup([found([item(ID_A)], 'https://next'), json([false])])
    const page = await provider.search!('foo', '999')
    expect(page.nextCursor).toBeUndefined()
    expect(fetchFn).toHaveBeenCalledTimes(2)

    const beyond = setup([])
    expect(await beyond.provider.search!('foo', '1000')).toEqual({ tracks: [] })
    expect(beyond.fetchFn).not.toHaveBeenCalled()
  })

  it('stops on an empty page even if Spotify still offers a next one', async () => {
    const { provider } = setup([found([], 'https://next')])
    expect((await provider.search!('foo', '20')).nextCursor).toBeUndefined()
  })

  it.each(['', '   ', 'x'.repeat(201)])('refuses the query %j without calling Spotify', async (query) => {
    const { provider, fetchFn } = setup([])
    await expect(provider.search!(query)).rejects.toThrow('Type something to search for')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it.each(['-1', 'abc', '1.5', '1e3'])('refuses the cursor %j', async (cursor) => {
    const { provider, fetchFn } = setup([])
    await expect(provider.search!('foo', cursor)).rejects.toThrow('Invalid library cursor')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("shows Spotify's own message when a search fails, and does not go on to ask what is saved", async () => {
    const { provider, fetchFn } = setup([json({ error: { status: 400, message: 'Invalid limit' } }, { status: 400 })])
    await expect(provider.search!('foo')).rejects.toThrow('Spotify: Invalid limit (status 400)')
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('refreshes an expired token once, like every other request', async () => {
    const { provider, session } = setup([empty(401), found([item(ID_A)]), json([false])])
    expect((await provider.search!('foo')).tracks).toHaveLength(1)
    expect(session.getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true })
  })

  it('does not call Spotify while it has said to stop', async () => {
    const gate = new RateLimitGate({ now: () => 0 })
    await gate.block(60 * 60 * 1000)
    const { provider, fetchFn } = setup([], { gate })
    await expect(provider.search!('foo')).rejects.toThrow(/rate limit/)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('is offered as a capability', async () => {
    expect(setup([]).provider.search).toBeTypeOf('function')
    expect(setup([]).provider.saveTrack).toBeTypeOf('function')
    expect(setup([]).provider.unsaveTrack).toBeTypeOf('function')
  })
})

describe('Spotify saving songs', () => {
  const uriOf = (fetchFn: ReturnType<typeof vi.fn>): string | null => requested(fetchFn).searchParams.get('uris')

  it('saves a track with PUT /me/library', async () => {
    const { provider, fetchFn } = setup([empty()])
    await provider.saveTrack!(ID_A)
    expect(methodOf(fetchFn)).toBe('PUT')
    const url = requested(fetchFn)
    expect(`${url.origin}${url.pathname}`).toBe('https://api.spotify.com/v1/me/library')
    expect(uriOf(fetchFn)).toBe(`spotify:track:${ID_A}`)
  })

  it('removes a track with DELETE /me/library', async () => {
    const { provider, fetchFn } = setup([empty()])
    await provider.unsaveTrack!(ID_A)
    expect(methodOf(fetchFn)).toBe('DELETE')
    expect(uriOf(fetchFn)).toBe(`spotify:track:${ID_A}`)
  })

  it('never uses the older type-specific endpoints', async () => {
    const { provider, fetchFn } = setup([empty(), empty()])
    await provider.saveTrack!(ID_A)
    await provider.unsaveTrack!(ID_A)
    for (const [url] of fetchFn.mock.calls as [string][]) expect(url).not.toContain('/me/tracks')
  })

  it.each(['', 'short', `${ID_A}x`, `${ID_A.slice(0, 20)}:,`, '../../me/library', `${ID_A}\n`])('refuses the track id %j without calling Spotify', async (id) => {
    const { provider, fetchFn } = setup([])
    await expect(provider.saveTrack!(id)).rejects.toThrow('not a valid Spotify track')
    await expect(provider.unsaveTrack!(id)).rejects.toThrow('not a valid Spotify track')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('asks the user to reconnect when the grant predates saving, without calling Spotify', async () => {
    const { provider, fetchFn, session } = setup([], { scopes: false })

    const failure = provider.saveTrack!(ID_A)
    await expect(failure).rejects.toBeInstanceOf(LibraryPermissionError)
    await expect(failure).rejects.toThrow('Reconnect Spotify to allow saving songs')
    await expect(provider.unsaveTrack!(ID_A)).rejects.toBeInstanceOf(LibraryPermissionError)
    expect(session.hasScopes).toHaveBeenCalledWith(['user-library-modify'])
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("shows Spotify's message when it refuses", async () => {
    const { provider } = setup([json({ error: { status: 403, message: 'Insufficient client scope' } }, { status: 403 })])
    await expect(provider.saveTrack!(ID_A)).rejects.toThrow('Spotify: Insufficient client scope (status 403)')
  })

  it('stops when Spotify is rate limiting, and does not send the save again', async () => {
    const { provider, fetchFn } = setup([new Response(null, { status: 429, headers: { 'Retry-After': '2' } }), empty()])
    await expect(provider.saveTrack!(ID_A)).rejects.toThrow(/rate limit/)
    expect(fetchFn).toHaveBeenCalledOnce()
  })
})

describe('Spotify grants', () => {
  it('needs the saving scope as well as playback to count as fully connected', async () => {
    const { provider, session } = setup([])
    await provider.needsReauthorization?.()
    expect(session.hasScopes).toHaveBeenCalledWith(REQUIRED_SCOPES)
    expect(REQUIRED_SCOPES).toEqual(['streaming', 'user-read-email', 'user-read-private', 'user-modify-playback-state', 'user-library-modify'])
  })

  it('flags a grant made before saving existed', async () => {
    const { provider } = setup([], { scopes: false })
    expect(await provider.needsReauthorization?.()).toBe(true)
  })
})
