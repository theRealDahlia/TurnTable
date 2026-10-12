import { describe, expect, it, vi } from 'vitest'
import { AuthRequiredError, type OAuthSession } from '../src/main/auth/session'
import { createDefaultRegistry } from '../src/main/providers/registry'
import { createSoundCloudProvider } from '../src/main/providers/soundcloud/provider'

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })

const item = (n: number, overrides: Record<string, unknown> = {}) => ({
  urn: `soundcloud:tracks:${n}`,
  title: `Everlong ${n}`,
  duration: 250_000,
  artwork_url: `https://i1.sndcdn.com/artworks-${n}-large.jpg`,
  permalink_url: `https://soundcloud.com/foo-fighters/everlong-${n}`,
  access: 'playable',
  user_favorite: false,
  user: { username: 'Foo Fighters' },
  ...overrides
})

function setup(responses: Response[]) {
  const session = {
    getAccessToken: vi.fn().mockResolvedValue('token-1'),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockResolvedValue(true),
    connect: vi.fn()
  }
  const fetchFn = vi.fn()
  for (const response of responses) fetchFn.mockResolvedValueOnce(response)
  const provider = createSoundCloudProvider(session as unknown as OAuthSession, { fetch: fetchFn as unknown as typeof fetch })
  return { session, fetchFn, provider }
}

const urlOf = (fetchFn: ReturnType<typeof vi.fn>, call = 0): URL => new URL((fetchFn.mock.calls[call] as [string])[0])
const methodOf = (fetchFn: ReturnType<typeof vi.fn>, call = 0): string => (fetchFn.mock.calls[call] as [string, RequestInit])[1].method!

describe('SoundCloud search', () => {
  it('searches tracks that can be played, a page at a time, in the form SoundCloud documents', async () => {
    const { provider, fetchFn } = setup([json({ collection: [item(1)] })])

    await provider.search!('foo fighters')

    const url = urlOf(fetchFn)
    expect(`${url.origin}${url.pathname}`).toBe('https://api.soundcloud.com/tracks')
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'foo fighters', access: 'playable', limit: '20', linked_partitioning: 'true' })
    expect(methodOf(fetchFn)).toBe('GET')
    expect((fetchFn.mock.calls[0] as [string, RequestInit])[1].headers).toEqual({ Authorization: 'OAuth token-1', Accept: 'application/json' })
  })

  it('keeps the characters of the query intact, including ones that matter in a URL', async () => {
    const { provider, fetchFn } = setup([json({ collection: [] })])
    await provider.search!('  AC/DC & "Back in Black" a=b#c  ')
    expect(urlOf(fetchFn).searchParams.get('q')).toBe('AC/DC & "Back in Black" a=b#c')
    expect([...urlOf(fetchFn).searchParams.keys()]).not.toContain('a')
  })

  it('maps results, and takes which are liked from the results themselves, with no second request', async () => {
    const { provider, fetchFn } = setup([json({ collection: [item(1), item(2, { user_favorite: true })] })])

    const page = await provider.search!('everlong')

    expect(fetchFn).toHaveBeenCalledOnce()
    expect(page.tracks).toEqual([
      expect.objectContaining({ id: 'soundcloud:tracks:1', title: 'Everlong 1', artists: ['Foo Fighters'], saved: false }),
      expect.objectContaining({ id: 'soundcloud:tracks:2', saved: true })
    ])
  })

  it('treats a result that does not say as not liked', async () => {
    const { provider } = setup([json({ collection: [item(1, { user_favorite: undefined })] })])
    expect((await provider.search!('x')).tracks[0]?.saved).toBe(false)
  })

  it('follows the cursor for more results, and stops at the last page', async () => {
    const { provider, fetchFn } = setup([
      json({ collection: [item(1)], next_href: 'https://api.soundcloud.com/tracks?q=x&cursor=20' }),
      json({ collection: [item(2)], next_href: null })
    ])
    const first = await provider.search!('x')
    expect(first.nextCursor).toBe('20')
    const second = await provider.search!('x', first.nextCursor)
    expect(urlOf(fetchFn, 1).searchParams.get('cursor')).toBe('20')
    expect(second.nextCursor).toBeUndefined()
  })

  it('skips results it cannot use, and copes with a response with no collection', async () => {
    const { provider } = setup([json({ collection: [null, item(1, { title: '' }), item(2)] }), json({})])
    expect((await provider.search!('x')).tracks.map((t) => t.id)).toEqual(['soundcloud:tracks:2'])
    expect(await provider.search!('x')).toEqual({ tracks: [], nextCursor: undefined })
  })

  it.each(['', '   ', 'x'.repeat(201)])('refuses the query %j without calling SoundCloud', async (query) => {
    const { provider, fetchFn } = setup([])
    await expect(provider.search!(query)).rejects.toThrow('Type something to search for')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it.each(['', 'a b', 'c&q=other', 'x'.repeat(301)])('refuses the cursor %j without calling SoundCloud', async (cursor) => {
    const { provider, fetchFn } = setup([])
    await expect(provider.search!('x', cursor)).rejects.toThrow('Invalid library cursor')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refreshes an expired token once, then asks the user to sign in again if it is still refused', async () => {
    const retried = setup([new Response(null, { status: 401 }), json({ collection: [item(1)] })])
    expect((await retried.provider.search!('x')).tracks).toHaveLength(1)
    expect(retried.session.getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true })

    const refused = setup([new Response(null, { status: 401 }), new Response(null, { status: 401 })])
    await expect(refused.provider.search!('x')).rejects.toBeInstanceOf(AuthRequiredError)
  })

  it('shows SoundCloud\'s message when a search is refused', async () => {
    const { provider } = setup([json({ code: 400, message: 'q is too long' }, { status: 400 })])
    await expect(provider.search!('x')).rejects.toThrow('SoundCloud: q is too long (status 400)')
  })
})

describe('SoundCloud saving songs', () => {
  const URN = 'soundcloud:tracks:12345'

  it('likes a track with POST /likes/tracks/{urn}', async () => {
    const { provider, fetchFn } = setup([json({ status: '200 - OK' })])
    await provider.saveTrack!(URN)
    expect(methodOf(fetchFn)).toBe('POST')
    expect(urlOf(fetchFn).pathname).toBe(`/likes/tracks/${URN}`)
    expect(urlOf(fetchFn).host).toBe('api.soundcloud.com')
  })

  it('removes the like with DELETE /likes/tracks/{urn}', async () => {
    const { provider, fetchFn } = setup([json({ status: '200 - OK' })])
    await provider.unsaveTrack!(URN)
    expect(methodOf(fetchFn)).toBe('DELETE')
    expect(urlOf(fetchFn).pathname).toBe(`/likes/tracks/${URN}`)
  })

  it.each(['', '12345', 'soundcloud:users:1', 'soundcloud:tracks:', 'soundcloud:tracks:1/../../me', 'soundcloud:tracks:1?x=1', `${URN}\n`, '../me'])(
    'refuses the id %j without calling SoundCloud',
    async (id) => {
      const { provider, fetchFn } = setup([])
      await expect(provider.saveTrack!(id)).rejects.toThrow('not a valid SoundCloud track')
      await expect(provider.unsaveTrack!(id)).rejects.toThrow('not a valid SoundCloud track')
      expect(fetchFn).not.toHaveBeenCalled()
    }
  )

  it("shows SoundCloud's own message when it refuses, and does not retry", async () => {
    const { provider, fetchFn } = setup([json({ code: 404, message: 'Track not found' }, { status: 404 })])
    await expect(provider.saveTrack!(URN)).rejects.toThrow('SoundCloud: Track not found (status 404)')
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('explains a rate limit', async () => {
    const { provider } = setup([json({ code: 429, message: 'slow down' }, { status: 429 })])
    await expect(provider.saveTrack!(URN)).rejects.toThrow('SoundCloud is limiting requests from this app')
  })

  it('refreshes an expired token once before liking', async () => {
    const { provider, session, fetchFn } = setup([new Response(null, { status: 401 }), json({ status: '200 - OK' })])
    await provider.saveTrack!(URN)
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(session.getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true })
  })
})

describe('SoundCloud in the registry', () => {
  it('reports that it can be searched and saved to', async () => {
    const { provider } = setup([])
    const status = (await createDefaultRegistry({ soundcloud: provider }).listStatuses()).find((s) => s.id === 'soundcloud')
    expect(status).toMatchObject({ searchable: true, savable: true })
  })
})
