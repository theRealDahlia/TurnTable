import { describe, expect, it, vi } from 'vitest'
import { AuthRequiredError, type OAuthSession } from '../src/main/auth/session'
import { createSpotifyProvider } from '../src/main/providers/spotify/provider'

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })

const item = (id: string | null, overrides = {}) => ({
  added_at: '2026-01-02T03:04:05Z',
  track: {
    id,
    name: `Song ${id}`,
    duration_ms: 200_000,
    artists: [{ name: 'Artist A' }, { name: 'Artist B' }],
    album: {
      name: 'Album',
      images: [
        { url: 'https://img/640', width: 640 },
        { url: 'https://img/300', width: 300 },
        { url: 'https://img/64', width: 64 }
      ]
    },
    external_urls: { spotify: `https://open.spotify.com/track/${id}` },
    ...overrides
  }
})

function setup(responses: Response[], random = () => 0) {
  const session = {
    getAccessToken: vi.fn().mockResolvedValue('token-1'),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn(),
    connect: vi.fn()
  }
  const fetchFn = vi.fn()
  for (const response of responses) fetchFn.mockResolvedValueOnce(response)
  const sleep = vi.fn().mockResolvedValue(undefined)
  const provider = createSpotifyProvider(session as unknown as OAuthSession, {
    fetch: fetchFn as unknown as typeof fetch,
    sleep,
    random
  })
  return { session, fetchFn, sleep, provider }
}

describe('Spotify getSavedTracks', () => {
  it('requests the first page with the access token and maps tracks', async () => {
    const { provider, fetchFn } = setup([json({ items: [item('abc')], next: null })])

    const page = await provider.getSavedTracks()

    expect(fetchFn).toHaveBeenCalledWith('https://api.spotify.com/v1/me/tracks?limit=50&offset=0', {
      headers: { Authorization: 'Bearer token-1' }
    })
    expect(page).toEqual({
      tracks: [
        {
          id: 'abc',
          providerId: 'spotify',
          title: 'Song abc',
          artists: ['Artist A', 'Artist B'],
          album: 'Album',
          durationMs: 200_000,
          artworkUrl: 'https://img/300',
          url: 'https://open.spotify.com/track/abc',
          savedAt: '2026-01-02T03:04:05Z'
        }
      ],
      nextCursor: undefined
    })
  })

  it('pages by offset and stops on the last page', async () => {
    const full = Array.from({ length: 50 }, (_, i) => item(`t${i}`))
    const { provider, fetchFn } = setup([
      json({ items: full, next: 'https://api.spotify.com/v1/me/tracks?offset=50' }),
      json({ items: [item('last')], next: null })
    ])

    const first = await provider.getSavedTracks()
    expect(first.tracks).toHaveLength(50)
    expect(first.nextCursor).toBe('50')

    const second = await provider.getSavedTracks(first.nextCursor)
    expect(fetchFn.mock.calls[1]![0]).toContain('offset=50')
    expect(second.nextCursor).toBeUndefined()
  })

  it('skips removed tracks, local files and tracks without an id, but still advances the cursor over them', async () => {
    const { provider } = setup([
      json({
        items: [item('ok'), { added_at: 'x', track: null }, item('local', { is_local: true }), item(null)],
        next: 'https://api.spotify.com/v1/me/tracks?offset=4'
      })
    ])

    const page = await provider.getSavedTracks()

    expect(page.tracks.map((t) => t.id)).toEqual(['ok'])
    expect(page.nextCursor).toBe('4')
  })

  it('does not loop forever if Spotify claims more pages but returns none', async () => {
    const { provider } = setup([json({ items: [], next: 'https://api.spotify.com/v1/me/tracks?offset=0' })])
    expect((await provider.getSavedTracks()).nextCursor).toBeUndefined()
  })

  it.each([
    ['a non-Spotify host', 'https://evil.example/track/abc'],
    ['plain http', 'http://open.spotify.com/track/abc'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a look-alike host', 'https://open.spotify.com.evil.example/track/abc']
  ])('does not pass on a link to %s', async (_label, url) => {
    const { provider } = setup([json({ items: [item('a', { external_urls: { spotify: url } })], next: null })])
    expect((await provider.getSavedTracks()).tracks[0]!.url).toBeUndefined()
  })

  it('copes with a track that has no external_urls', async () => {
    const { provider } = setup([json({ items: [item('a', { external_urls: undefined })], next: null })])
    expect((await provider.getSavedTracks()).tracks[0]!.url).toBeUndefined()
  })

  it('handles tracks with no album or artwork', async () => {
    const { provider } = setup([json({ items: [item('a', { album: undefined })], next: null })])
    const [track] = (await provider.getSavedTracks()).tracks
    expect(track).toMatchObject({ album: undefined, artworkUrl: undefined })
  })

  it('falls back to the largest image when none is big enough', async () => {
    const images = [
      { url: 'https://img/64', width: 64 },
      { url: 'https://img/200', width: 200 }
    ]
    const { provider } = setup([json({ items: [item('a', { album: { name: 'A', images } })], next: null })])
    expect((await provider.getSavedTracks()).tracks[0]!.artworkUrl).toBe('https://img/200')
  })

  it.each(['-1', '1.5', 'abc', '99999999999', '50&limit=1', ''])('rejects the invalid cursor %j', async (cursor) => {
    const { provider, fetchFn } = setup([])
    await expect(provider.getSavedTracks(cursor)).rejects.toThrow('Invalid library cursor')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('retries once with a force-refreshed token after a 401', async () => {
    const { provider, session, fetchFn } = setup([
      new Response(null, { status: 401 }),
      json({ items: [item('abc')], next: null })
    ])
    session.getAccessToken.mockResolvedValueOnce('stale').mockResolvedValueOnce('fresh')

    const page = await provider.getSavedTracks()

    expect(page.tracks).toHaveLength(1)
    expect(session.getAccessToken).toHaveBeenNthCalledWith(1, { forceRefresh: false })
    expect(session.getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true })
    expect(fetchFn.mock.calls[1]![1]).toEqual({ headers: { Authorization: 'Bearer fresh' } })
  })

  it('signs the user out when a refreshed token is still rejected', async () => {
    const { provider, session } = setup([new Response(null, { status: 401 }), new Response(null, { status: 401 })])

    await expect(provider.getSavedTracks()).rejects.toBeInstanceOf(AuthRequiredError)
    expect(session.disconnect).toHaveBeenCalledOnce()
  })

  describe('rate limiting (429)', () => {
    const limited = (retryAfter?: string): Response =>
      new Response(null, { status: 429, headers: retryAfter ? { 'Retry-After': retryAfter } : {} })

    it('waits for Retry-After, then retries and succeeds', async () => {
      const { provider, sleep, fetchFn } = setup([limited('7'), json({ items: [item('abc')], next: null })])

      const page = await provider.getSavedTracks()

      expect(page.tracks).toHaveLength(1)
      expect(sleep).toHaveBeenCalledExactlyOnceWith(7000)
      expect(fetchFn).toHaveBeenCalledTimes(2)
    })

    it('never retries immediately, even when Retry-After is missing, zero or malformed', async () => {
      for (const header of [undefined, '0', 'soon', '-3']) {
        const { provider, sleep } = setup([limited(header), json({ items: [], next: null })])
        await provider.getSavedTracks()
        expect(sleep).toHaveBeenCalledOnce()
        expect(sleep.mock.calls[0]![0]).toBeGreaterThanOrEqual(1000)
      }
    })

    it('backs off exponentially when Spotify keeps refusing, then gives up', async () => {
      const { provider, sleep, fetchFn } = setup([limited(), limited(), limited(), limited()])

      await expect(provider.getSavedTracks()).rejects.toThrow('rate limiting')

      expect(sleep.mock.calls.map((call) => call[0])).toEqual([1000, 2000, 4000])
      expect(fetchFn).toHaveBeenCalledTimes(4)
    })

    it('adds jitter to the backoff', async () => {
      const { provider, sleep } = setup([limited(), json({ items: [], next: null })], () => 0.5)
      await provider.getSavedTracks()
      expect(sleep).toHaveBeenCalledWith(1125)
    })

    it('lets a long Retry-After win over a short backoff', async () => {
      const { provider, sleep } = setup([limited('20'), limited('3'), json({ items: [], next: null })])
      await provider.getSavedTracks()
      expect(sleep.mock.calls.map((call) => call[0])).toEqual([20_000, 3000])
    })

    it('reports instead of waiting when asked to wait unreasonably long', async () => {
      const { provider, sleep, fetchFn } = setup([limited('3600')])

      await expect(provider.getSavedTracks()).rejects.toThrow('Try again in 3600s')
      expect(sleep).not.toHaveBeenCalled()
      expect(fetchFn).toHaveBeenCalledOnce()
    })
  })

  describe('API errors', () => {
    const failure = (status: number, body: unknown): Response =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

    it('shows the message Spotify returned, e.g. for a 403', async () => {
      const { provider } = setup([failure(403, { error: { status: 403, message: 'User not registered in the Developer Dashboard' } })])
      await expect(provider.getSavedTracks()).rejects.toThrow(
        'Spotify: User not registered in the Developer Dashboard (status 403)'
      )
    })

    it.each([
      ['a non-JSON body', 'internal detail'],
      ['an empty body', ''],
      ['JSON of another shape', { oops: true }],
      ['a non-string message', { error: { message: { nested: 1 } } }],
      ['a blank message', { error: { message: '   ' } }]
    ])('falls back to the status code for %s, without echoing the body', async (_label, body) => {
      const { provider } = setup([failure(500, body)])
      const error = await provider.getSavedTracks().catch((e: Error) => e)
      expect((error as Error).message).toBe('Spotify request failed with status 500')
    })

    it('strips control characters and caps the length of the message', async () => {
      const long = `bad\u0000\n${'x'.repeat(500)}`
      const { provider } = setup([failure(400, { error: { status: 400, message: long } })])

      const message = ((await provider.getSavedTracks().catch((e: Error) => e)) as Error).message

      expect([...message].every((char) => char.codePointAt(0)! >= 32)).toBe(true)
      expect(message.length).toBeLessThan(260)
      expect(message).toMatch(/^Spotify: bad {2}x+ \(status 400\)$/)
    })
  })

  it('asks the user to reconnect when the session is gone', async () => {
    const { provider, session } = setup([])
    session.getAccessToken.mockRejectedValue(new AuthRequiredError('Spotify'))
    await expect(provider.getSavedTracks()).rejects.toThrow('Please reconnect')
  })
})
