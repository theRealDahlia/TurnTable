import { describe, expect, it, vi } from 'vitest'
import { AuthRequiredError, type OAuthSession } from '../src/main/auth/session'
import { createSpotifyProvider } from '../src/main/providers/spotify/provider'
import { RateLimitGate, type RateLimitStore } from '../src/main/providers/spotify/rateLimit'

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })

const item = (id: string | null, overrides = {}) => ({
  added_at: '2026-01-02T03:04:05Z',
  track: {
    id,
    name: `Song ${id}`,
    duration_ms: 200_000,
    disc_number: 1,
    track_number: 4,
    // Spotify gives every artist an id; the second here is malformed, so it isn't kept.
    artists: [{ name: 'Artist A', id: '0TnOYISbd1XYRBk9myaseg' }, { name: 'Artist B', id: 'bad id' }],
    album: {
      id: '2noRn2Aes5aoNVsU6iWThc',
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

function setup(responses: Response[], random = () => 0, extra: { now?: () => number; gate?: RateLimitGate } = {}) {
  const session = {
    getAccessToken: vi.fn().mockResolvedValue('token-1'),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn(),
    hasScopes: vi.fn().mockResolvedValue(true),
    connect: vi.fn()
  }
  const fetchFn = vi.fn()
  for (const response of responses) fetchFn.mockResolvedValueOnce(response)
  const sleep = vi.fn().mockResolvedValue(undefined)
  const provider = createSpotifyProvider(session as unknown as OAuthSession, {
    fetch: fetchFn as unknown as typeof fetch,
    sleep,
    random,
    ...extra
  })
  return { session, fetchFn, sleep, provider }
}

describe('Spotify getSavedTracks', () => {
  it('requests the first page with the access token and maps tracks', async () => {
    const { provider, fetchFn } = setup([json({ items: [item('abc')], next: null })])

    const page = await provider.getSavedTracks()

    expect(fetchFn).toHaveBeenCalledWith('https://api.spotify.com/v1/me/tracks?limit=50&offset=0', {
      method: undefined,
      headers: { Authorization: 'Bearer token-1' },
      body: undefined
    })
    expect(page).toEqual({
      tracks: [
        {
          id: 'abc',
          providerId: 'spotify',
          title: 'Song abc',
          artists: ['Artist A', 'Artist B'],
          artistIds: ['0TnOYISbd1XYRBk9myaseg', ''],
          album: 'Album',
          albumId: '2noRn2Aes5aoNVsU6iWThc',
          discNumber: 1,
          trackNumber: 4,
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
    expect(fetchFn.mock.calls[1]![1]).toMatchObject({ headers: { Authorization: 'Bearer fresh' } })
  })

  it('signs the user out when a refreshed token is still rejected', async () => {
    const { provider, session } = setup([new Response(null, { status: 401 }), new Response(null, { status: 401 })])

    await expect(provider.getSavedTracks()).rejects.toBeInstanceOf(AuthRequiredError)
    expect(session.disconnect).toHaveBeenCalledOnce()
  })

  describe('rate limiting (429)', () => {
    const limited = (retryAfter?: string): Response =>
      new Response(null, { status: 429, headers: retryAfter ? { 'Retry-After': retryAfter } : {} })

    it('stops at the first refusal, without waiting or retrying, and says when to try again', async () => {
      const { provider, sleep, fetchFn } = setup([limited('7')], () => 0, { now: () => 1_000_000 })

      await expect(provider.getSavedTracks()).rejects.toThrow(/rate limit.*in about 7 seconds/)

      expect(fetchFn).toHaveBeenCalledOnce()
      expect(sleep).not.toHaveBeenCalled()
    })

    it('never retries at once, even when Retry-After is missing, zero or malformed: it stops for at least the backoff', async () => {
      for (const header of [undefined, '0', 'soon', '-3']) {
        let time = 1_000_000
        const { provider, fetchFn } = setup([limited(header), json({ items: [], next: null })], () => 0, { now: () => time })

        await expect(provider.getSavedTracks()).rejects.toThrow('rate limit')
        await expect(provider.getSavedTracks()).rejects.toThrow('rate limit')
        expect(fetchFn).toHaveBeenCalledOnce()

        time += 5001
        await provider.getSavedTracks()
        expect(fetchFn).toHaveBeenCalledTimes(2)
      }
    })

    it('stops for twice as long each time Spotify refuses again straight after', async () => {
      let time = 1_000_000
      const { provider } = setup([limited(), limited(), limited(), json({ items: [], next: null })], () => 0, { now: () => time })
      const until = async (): Promise<number> => {
        const error = (await provider.getSavedTracks().catch((e: unknown) => e)) as { until: number }
        return error.until - time
      }

      const waits: number[] = []
      for (let i = 0; i < 3; i++) {
        waits.push(await until())
        time += waits[i]! + 1
      }

      expect(waits).toEqual([5000, 10_000, 20_000])
    })

    it('starts the backoff again after a request that worked', async () => {
      let time = 1_000_000
      const { provider } = setup([limited(), json({ items: [], next: null }), limited()], () => 0, { now: () => time })

      await expect(provider.getSavedTracks()).rejects.toThrow('rate limit')
      time += 5001
      await provider.getSavedTracks()
      const error = (await provider.getSavedTracks().catch((e: unknown) => e)) as { until: number }

      expect(error.until - time).toBe(5000)
    })

    it('adds jitter to the backoff', async () => {
      const { provider } = setup([limited()], () => 0.5, { now: () => 1_000_000 })
      const error = (await provider.getSavedTracks().catch((e: unknown) => e)) as { until: number }
      expect(error.until - 1_000_000).toBe(5125)
    })

    it('lets a long Retry-After win over a short backoff', async () => {
      const { provider } = setup([limited('20')], () => 0, { now: () => 1_000_000 })
      const error = (await provider.getSavedTracks().catch((e: unknown) => e)) as { until: number }
      expect(error.until - 1_000_000).toBe(20_000)
    })

    it('reports a long wait with the clock time', async () => {
      const { provider, sleep, fetchFn } = setup([limited('3600')])

      await expect(provider.getSavedTracks()).rejects.toThrow(/rate limit.*in about 1 hour/)
      expect(sleep).not.toHaveBeenCalled()
      expect(fetchFn).toHaveBeenCalledOnce()
    })

    describe('after Spotify says to stop for a long time', () => {
      const memoryStore = (): RateLimitStore & { saved?: number } => {
        const store: RateLimitStore & { saved?: number } = {
          read: async () => store.saved,
          write: async (value) => void (store.saved = value)
        }
        return store
      }

      it('sends nothing more to Spotify until the wait is over, then resumes', async () => {
        let time = 1_000_000
        const { provider, fetchFn, session } = setup([limited('3600'), json({ items: [item('abc')], next: null })], () => 0, { now: () => time })

        await expect(provider.getSavedTracks()).rejects.toThrow('rate limit')
        for (let i = 0; i < 3; i++) await expect(provider.getSavedTracks()).rejects.toThrow('rate limit')
        expect(fetchFn).toHaveBeenCalledOnce()
        expect(session.getAccessToken).toHaveBeenCalledOnce()

        time += 3_600_000 + 1
        expect((await provider.getSavedTracks()).tracks).toHaveLength(1)
        expect(fetchFn).toHaveBeenCalledTimes(2)
      })

      it('also holds back starting playback and paging', async () => {
        const { provider, fetchFn } = setup([limited('3600')], () => 0, { now: () => 1_000_000 })
        await expect(provider.getSavedTracks()).rejects.toThrow('rate limit')

        await expect(provider.startPlayback('abcdef0123456789abcdef0123456789abcdef01', '4iV5W9uYEdYUVa79Axb7Rh')).rejects.toThrow('rate limit')
        await expect(provider.getSavedTracks('50')).rejects.toThrow('rate limit')
        expect(fetchFn).toHaveBeenCalledOnce()
      })

      it('remembers the wait across a restart', async () => {
        const store = memoryStore()
        const now = () => 1_000_000
        const first = setup([limited('86000')], () => 0, { gate: new RateLimitGate({ store, now }), now })
        await expect(first.provider.getSavedTracks()).rejects.toThrow('rate limit')
        expect(store.saved).toBe(1_000_000 + 86_000_000)

        // A new run of the app: new provider, new gate, same saved file.
        const second = setup([json({ items: [], next: null })], () => 0, { gate: new RateLimitGate({ store, now }), now })
        await expect(second.provider.getSavedTracks()).rejects.toThrow(/rate limit.*in about 24 hours/)
        expect(second.fetchFn).not.toHaveBeenCalled()
        expect(second.session.getAccessToken).not.toHaveBeenCalled()
      })
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
      // 501 is not one of the passing server errors that are asked again.
      const { provider } = setup([failure(501, body)])
      const error = await provider.getSavedTracks().catch((e: Error) => e)
      expect((error as Error).message).toBe('Spotify request failed with status 501')
    })

    describe('passing server errors', () => {
      const hiccup = (status = 502): Response => failure(status, { error: { status, message: 'An unexpected error occurred. Please try again later.' } })
      const page = (): Response => new Response(JSON.stringify({ items: [item('abc')], next: null }), { status: 200, headers: { 'Content-Type': 'application/json' } })

      it.each([500, 502, 503, 504])('asks again after a pause when Spotify answers a read with %i, and carries on', async (status) => {
        const { provider, fetchFn, sleep } = setup([hiccup(status), hiccup(status), page()])

        const { tracks } = await provider.getSavedTracks()

        expect(tracks.map((t) => t.id)).toEqual(['abc'])
        expect(fetchFn).toHaveBeenCalledTimes(3)
        expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([2000, 5000])
      })

      it("gives up after the third try, with Spotify's own message", async () => {
        const { provider, fetchFn } = setup([hiccup(), hiccup(), hiccup(), page()])
        await expect(provider.getSavedTracks()).rejects.toThrow('Spotify: An unexpected error occurred. Please try again later. (status 502)')
        expect(fetchFn).toHaveBeenCalledTimes(3)
      })

      it('never asks again for a change to the library, which Spotify may already have made', async () => {
        const { provider, fetchFn, sleep } = setup([hiccup(), new Response(null, { status: 200 })])
        await expect(provider.saveTrack!('4iV5W9uYEdYUVa79Axb7Rh')).rejects.toThrow('(status 502)')
        expect(fetchFn).toHaveBeenCalledOnce()
        expect(sleep).not.toHaveBeenCalled()
      })
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
