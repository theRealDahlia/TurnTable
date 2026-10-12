import { describe, expect, it, vi } from 'vitest'
import { AuthRequiredError } from '../src/main/auth/session'
import type { TokenStore } from '../src/main/auth/tokenStore'
import { createQobuzProvider, qualityFor, toTrack } from '../src/main/providers/qobuz/provider'
import { QobuzSession, type QobuzTier } from '../src/main/providers/qobuz/session'
import type { TokenSet } from '../src/shared/types'

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })

const item = (id: number | string, overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Everlong ${id}`,
  version: null,
  duration: 250,
  streamable: true,
  maximum_bit_depth: 24,
  maximum_sampling_rate: 96,
  performer: { name: 'Foo Fighters' },
  album: { title: 'The Colour and the Shape', image: { large: 'https://static.qobuz.com/large.jpg', small: 'https://static.qobuz.com/small.jpg', thumbnail: 'https://static.qobuz.com/thumb.jpg' }, artist: { name: 'Album Artist' } },
  ...overrides
})
const page = (items: unknown[], total = items.length, offset = 0) => json({ tracks: { items, total, offset } })

function setup(responses: Response[], tier: QobuzTier | null = 'hires') {
  const saved = new Map<string, TokenSet>()
  if (tier) saved.set('qobuz', { accessToken: 'user-token', expiresAt: Number.MAX_SAFE_INTEGER, scope: tier })
  const store = { get: async (id: string) => saved.get(id), set: async (id: string, t: TokenSet) => void saved.set(id, t), delete: async (id: string) => void saved.delete(id) }
  const session = new QobuzSession({ app: () => ({ appId: 'app-id-1', appSecret: 'app-secret-1' }), store: store as unknown as TokenStore, fetch: vi.fn() as never, now: () => 0 })
  const fetchFn = vi.fn()
  for (const response of responses) fetchFn.mockResolvedValueOnce(response)
  const provider = createQobuzProvider(session, { fetch: fetchFn as unknown as typeof fetch, app: () => ({ appId: 'app-id-1', appSecret: 'app-secret-1' }) })
  return { provider, session, fetchFn, saved }
}

const urlOf = (fetchFn: ReturnType<typeof vi.fn>, call = 0): URL => new URL((fetchFn.mock.calls[call] as [string])[0])
const headersOf = (fetchFn: ReturnType<typeof vi.fn>, call = 0): Record<string, string> => (fetchFn.mock.calls[call] as [string, RequestInit])[1].headers as Record<string, string>

describe('qualityFor', () => {
  it('gives a hi-res subscription what the track has', () => {
    expect(qualityFor(item(1), 'hires')).toEqual({ codec: 'flac', lossless: true, bitDepth: 24, sampleRateHz: 96000 })
    expect(qualityFor(item(1, { maximum_sampling_rate: 192 }), 'hires')).toMatchObject({ sampleRateHz: 192000 })
    expect(qualityFor(item(1, { maximum_sampling_rate: 176.4 }), 'hires')).toMatchObject({ sampleRateHz: 176400 })
  })

  it('stops a lossless subscription at CD quality, whatever the track has', () => {
    expect(qualityFor(item(1), 'lossless')).toEqual({ codec: 'flac', lossless: true, bitDepth: 16, sampleRateHz: 44100 })
    expect(qualityFor(item(1, { maximum_bit_depth: 16, maximum_sampling_rate: 44.1 }), 'lossless')).toEqual({ codec: 'flac', lossless: true, bitDepth: 16, sampleRateHz: 44100 })
  })

  it('gives a lossy subscription 320 kbps MP3, and an account that cannot stream nothing', () => {
    expect(qualityFor(item(1), 'lossy')).toEqual({ codec: 'mp3', lossless: false, bitrateKbps: 320 })
    expect(qualityFor(item(1), 'none')).toBeUndefined()
  })

  it('assumes CD quality for a track that does not say', () => {
    expect(qualityFor({ id: 1 }, 'hires')).toEqual({ codec: 'flac', lossless: true, bitDepth: 16, sampleRateHz: 44100 })
  })
})

describe('toTrack', () => {
  it('maps a track', () => {
    expect(toTrack(item(7), 'hires')).toEqual({
      id: '7',
      providerId: 'qobuz',
      title: 'Everlong 7',
      artists: ['Foo Fighters'],
      album: 'The Colour and the Shape',
      durationMs: 250_000,
      artworkUrl: 'https://static.qobuz.com/large.jpg',
      url: 'https://open.qobuz.com/track/7',
      quality: { codec: 'flac', lossless: true, bitDepth: 24, sampleRateHz: 96000 },
      savedAt: undefined
    })
  })

  it('puts a version in the title, and falls back to the album\'s artist', () => {
    expect(toTrack(item(7, { version: 'Remastered' }), 'hires')?.title).toBe('Everlong 7 (Remastered)')
    expect(toTrack(item(7, { performer: null }), 'hires')?.artists).toEqual(['Album Artist'])
    expect(toTrack(item(7, { performer: null, album: { title: 'x' } }), 'hires')?.artists).toEqual([])
  })

  it.each([
    ['no id', { id: undefined }],
    ['an id that is not a number', { id: 'abc' }],
    ['an id that could alter a URL', { id: '7/../me' }],
    ['no title', { title: '' }]
  ])('skips a track with %s', (_label, overrides) => {
    expect(toTrack(item(7, overrides), 'hires')).toBeUndefined()
  })

  it('skips an empty entry', () => {
    expect(toTrack(null, 'hires')).toBeUndefined()
  })

  it('accepts a numeric string id', () => {
    expect(toTrack(item('123'), 'hires')?.id).toBe('123')
  })

  it('marks tracks that are not streamable, and everything for an account that cannot stream, as unplayable', () => {
    expect(toTrack(item(1), 'hires')).not.toHaveProperty('playable')
    expect(toTrack(item(1, { streamable: false }), 'hires')?.playable).toBe(false)
    expect(toTrack(item(1), 'none')?.playable).toBe(false)
    expect(toTrack(item(1, { streamable: undefined }), 'lossless')).not.toHaveProperty('playable')
  })

  it('uses the best artwork there is, https only', () => {
    expect(toTrack(item(1, { album: { image: { large: null, small: 'https://x/s.jpg' } } }), 'hires')?.artworkUrl).toBe('https://x/s.jpg')
    expect(toTrack(item(1, { album: { image: { large: 'http://x/l.jpg', thumbnail: 'https://x/t.jpg' } } }), 'hires')?.artworkUrl).toBe('https://x/t.jpg')
    expect(toTrack(item(1, { album: { image: { large: 'http://x/l.jpg' } } }), 'hires')?.artworkUrl).toBeUndefined()
    expect(toTrack(item(1, { album: null }), 'hires')?.artworkUrl).toBeUndefined()
  })

  it.each([undefined, -5, 0])('treats a duration of %j as unknown', (duration) => {
    expect(toTrack(item(1, { duration }), 'hires')?.durationMs).toBe(0)
  })

  it('reads when a track was added, when Qobuz says', () => {
    expect(toTrack(item(1, { favorited_at: 1_700_000_000 }), 'hires')?.savedAt).toBe('2023-11-14T22:13:20.000Z')
    expect(toTrack(item(1, { favorited_at: 0 }), 'hires')?.savedAt).toBeUndefined()
  })
})

describe('Qobuz getSavedTracks', () => {
  it("asks for the user's favorite tracks with their token and the application's ID, never the secret", async () => {
    const { provider, fetchFn } = setup([page([item(1)])])

    await provider.getSavedTracks()

    const url = urlOf(fetchFn)
    expect(`${url.origin}${url.pathname}`).toBe('https://www.qobuz.com/api.json/0.2/favorite/getUserFavorites')
    expect(Object.fromEntries(url.searchParams)).toEqual({ type: 'tracks', limit: '50', offset: '0' })
    expect(headersOf(fetchFn)).toEqual({ 'X-App-Id': 'app-id-1', 'X-User-Auth-Token': 'user-token', Accept: 'application/json' })
    expect(JSON.stringify(fetchFn.mock.calls)).not.toContain('app-secret-1')
  })

  it('maps tracks, showing what the subscription can deliver', async () => {
    const { provider } = setup([page([item(1), item(2)], 2)], 'lossless')
    const result = await provider.getSavedTracks()
    expect(result.tracks.map((t) => t.quality)).toEqual([
      { codec: 'flac', lossless: true, bitDepth: 16, sampleRateHz: 44100 },
      { codec: 'flac', lossless: true, bitDepth: 16, sampleRateHz: 44100 }
    ])
  })

  it('pages by offset until the total is reached', async () => {
    const { provider, fetchFn } = setup([page([item(1), item(2)], 5), page([item(3), item(4)], 5, 2), page([item(5)], 5, 4)])
    const first = await provider.getSavedTracks()
    expect(first.nextCursor).toBe('2')
    const second = await provider.getSavedTracks(first.nextCursor)
    expect(urlOf(fetchFn, 1).searchParams.get('offset')).toBe('2')
    expect(second.nextCursor).toBe('4')
    expect((await provider.getSavedTracks(second.nextCursor)).nextCursor).toBeUndefined()
  })

  it('stops on an empty page even if the total says there is more', async () => {
    const { provider } = setup([page([], 99)])
    expect((await provider.getSavedTracks('10')).nextCursor).toBeUndefined()
  })

  it('copes with a response with no tracks', async () => {
    const { provider } = setup([json({})])
    expect(await provider.getSavedTracks()).toEqual({ tracks: [], nextCursor: undefined })
  })

  it.each(['-1', 'abc', '1.5', '1e3'])('refuses the cursor %j before calling Qobuz', async (cursor) => {
    const { provider, fetchFn } = setup([])
    await expect(provider.getSavedTracks(cursor)).rejects.toThrow('Invalid library cursor')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('asks the user to sign in when there is no sign-in, without calling Qobuz', async () => {
    const { provider, fetchFn } = setup([], null)
    await expect(provider.getSavedTracks()).rejects.toBeInstanceOf(AuthRequiredError)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('Qobuz errors', () => {
  it('ends the sign-in and asks to sign in again when Qobuz refuses the token', async () => {
    const { provider, saved } = setup([new Response(null, { status: 401 })])
    await expect(provider.getSavedTracks()).rejects.toBeInstanceOf(AuthRequiredError)
    expect(saved.has('qobuz')).toBe(false)
  })

  it("shows Qobuz's own message", async () => {
    const { provider } = setup([json({ status: 'error', code: 400, message: 'Invalid offset' }, { status: 400 })])
    await expect(provider.getSavedTracks()).rejects.toThrow('Qobuz: Invalid offset (status 400)')
  })

  it('explains a rate limit and does not retry', async () => {
    const { provider, fetchFn } = setup([new Response(null, { status: 429 })])
    await expect(provider.getSavedTracks()).rejects.toThrow('Qobuz is limiting requests from this app. Try again later.')
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('cleans up messages before showing them', async () => {
    const { provider } = setup([json({ message: `bad\u0000\n${'x'.repeat(500)}` }, { status: 400 })])
    const error = (await provider.getSavedTracks().catch((e: unknown) => e)) as Error
    expect(error.message).not.toMatch(/\p{Cc}/u)
    expect(error.message.length).toBeLessThan(260)
  })

  it.each([
    ['a body that is not JSON', new Response('<html>', { status: 500 })],
    ['an error without a message', json({ code: 500 }, { status: 500 })]
  ])('falls back to the status for %s', async (_label, response) => {
    const { provider } = setup([response])
    await expect(provider.getSavedTracks()).rejects.toThrow('Qobuz request failed with status 500')
  })
})

describe('Qobuz search', () => {
  it('searches tracks, a page at a time, and asks which are already favorites', async () => {
    const { provider, fetchFn } = setup([page([item(1), item(2)], 40), json({ tracks: [2, 99] })])

    const result = await provider.search!('foo fighters')

    const search = fetchFn.mock.calls.map((_, i) => urlOf(fetchFn, i)).find((u) => u.pathname.endsWith('/track/search'))!
    expect(Object.fromEntries(search.searchParams)).toEqual({ query: 'foo fighters', limit: '20', offset: '0' })
    const ids = fetchFn.mock.calls.map((_, i) => urlOf(fetchFn, i)).find((u) => u.pathname.endsWith('/favorite/getUserFavoriteIds'))!
    expect(Object.fromEntries(ids.searchParams)).toEqual({ type: 'tracks', limit: '5000' })
    expect(result.tracks.map((t) => [t.id, t.saved])).toEqual([
      ['1', false],
      ['2', true]
    ])
    expect(result.nextCursor).toBe('2')
  })

  it('keeps the characters of the query intact', async () => {
    const { provider, fetchFn } = setup([page([]), json({})])
    await provider.search!('  AC/DC & "Back in Black" a=b#c  ')
    const search = fetchFn.mock.calls.map((_, i) => urlOf(fetchFn, i)).find((u) => u.pathname.endsWith('/track/search'))!
    expect(search.searchParams.get('query')).toBe('AC/DC & "Back in Black" a=b#c')
    expect([...search.searchParams.keys()].sort()).toEqual(['limit', 'offset', 'query'])
  })

  it('treats a missing list of favorites as none', async () => {
    const { provider } = setup([page([item(1)]), json({})])
    expect((await provider.search!('x')).tracks[0]?.saved).toBe(false)
  })

  it('pages by offset', async () => {
    const { provider, fetchFn } = setup([page([item(3)], 21, 20), json({})])
    const result = await provider.search!('x', '20')
    expect(fetchFn.mock.calls.some((_, i) => urlOf(fetchFn, i).searchParams.get('offset') === '20')).toBe(true)
    expect(result.nextCursor).toBeUndefined()
  })

  it.each(['', '   ', 'x'.repeat(201)])('refuses the query %j without calling Qobuz', async (query) => {
    const { provider, fetchFn } = setup([])
    await expect(provider.search!(query)).rejects.toThrow('Type something to search for')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('shows Qobuz\'s message if the search fails', async () => {
    const { provider } = setup([json({ message: 'Bad query' }, { status: 400 }), json({})])
    await expect(provider.search!('x')).rejects.toThrow('Qobuz: Bad query (status 400)')
  })
})

describe('Qobuz saving songs', () => {
  it('adds a favorite, and removes it', async () => {
    const { provider, fetchFn } = setup([json({ status: 'success' }), json({ status: 'success' })])

    await provider.saveTrack!('12345')
    await provider.unsaveTrack!('12345')

    expect(urlOf(fetchFn, 0).pathname).toBe('/api.json/0.2/favorite/create')
    expect(urlOf(fetchFn, 0).searchParams.get('track_ids')).toBe('12345')
    expect(urlOf(fetchFn, 1).pathname).toBe('/api.json/0.2/favorite/delete')
    expect(urlOf(fetchFn, 1).searchParams.get('track_ids')).toBe('12345')
  })

  it.each(['', 'abc', '12 3', '1,2', '1&type=album', '../x', `1\n`, '1'.repeat(13)])('refuses the id %j without calling Qobuz', async (id) => {
    const { provider, fetchFn } = setup([])
    await expect(provider.saveTrack!(id)).rejects.toThrow('not a valid Qobuz track')
    await expect(provider.unsaveTrack!(id)).rejects.toThrow('not a valid Qobuz track')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('shows Qobuz\'s message when it refuses', async () => {
    const { provider } = setup([json({ message: 'Track not found' }, { status: 404 })])
    await expect(provider.saveTrack!('1')).rejects.toThrow('Qobuz: Track not found (status 404)')
  })
})
