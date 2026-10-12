import { describe, expect, it, vi } from 'vitest'
import type { OAuthSession } from '../src/main/auth/session'
import { createTidalProvider } from '../src/main/providers/tidal/provider'

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/vnd.api+json' }, ...init })

const trackResources = (ids: string[]) => [
  ...ids.map((id) => ({
    id,
    type: 'tracks',
    attributes: { title: `Song ${id}`, duration: 'PT4M10S' },
    relationships: { artists: { data: [{ id: 'a1', type: 'artists' }] }, albums: { data: [{ id: 'al1', type: 'albums' }] } }
  })),
  { id: 'a1', type: 'artists', attributes: { name: 'Foo Fighters' } },
  { id: 'al1', type: 'albums', attributes: { title: 'Wasting Light' } }
]

/** What searching returns: one search result, whose `tracks` relationship lists the matches. */
const firstPage = (ids: string[], next?: string) => ({
  data: [
    {
      id: 'foo fighters',
      type: 'searchResults',
      attributes: { trackingId: 't' },
      relationships: { tracks: { data: ids.map((id) => ({ id, type: 'tracks' })), links: next ? { self: '/x', next: `/searchResults/foo%20fighters/relationships/tracks?page%5Bcursor%5D=${next}`, meta: { nextCursor: next } } : { self: '/x' } } }
    }
  ],
  included: trackResources(ids)
})

const laterPage = (ids: string[], next?: string) => ({
  data: ids.map((id) => ({ id, type: 'tracks' })),
  included: trackResources(ids),
  links: next ? { next: `/x?page%5Bcursor%5D=${next}`, meta: { nextCursor: next } } : {}
})

function setup(responses: Response[], granted = true) {
  const session = {
    getAccessToken: vi.fn().mockResolvedValue('token-1'),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockResolvedValue(true),
    hasScopes: vi.fn().mockResolvedValue(granted),
    connect: vi.fn()
  }
  const queue = [...responses]
  const fetchFn = vi.fn(async () => queue.shift() ?? json(firstPage([])))
  const provider = createTidalProvider(session as unknown as OAuthSession, { fetch: fetchFn as unknown as typeof fetch })
  const urlOf = (call: number): URL => new URL(String((fetchFn.mock.calls[call] as unknown[])[0]))
  const initOf = (call: number): RequestInit => (fetchFn.mock.calls[call] as unknown as [string, RequestInit])[1]
  return { session, fetchFn, provider, urlOf, initOf }
}

describe('TIDAL search', () => {
  it('searches the catalog by the words typed, with the tracks and their details along with them', async () => {
    const { provider, urlOf, initOf } = setup([json(firstPage(['1', '2']))])

    const page = await provider.search!('  foo fighters  ')

    const url = urlOf(0)
    expect(url.origin + url.pathname).toBe('https://openapi.tidal.com/v2/searchResults')
    expect(url.searchParams.get('filter[query]')).toBe('foo fighters')
    expect(url.searchParams.get('include')).toBe('tracks,tracks.artists,tracks.albums,tracks.albums.coverArt')
    expect(initOf(0).headers).toMatchObject({ Authorization: 'Bearer token-1' })
    expect(page.tracks.map((track) => [track.id, track.title, track.artists, track.album])).toEqual([
      ['1', 'Song 1', ['Foo Fighters'], 'Wasting Light'],
      ['2', 'Song 2', ['Foo Fighters'], 'Wasting Light']
    ])
    expect(page.nextCursor).toBeUndefined()
  })

  it("continues through the same search result's track list with one cursor", async () => {
    const { provider, urlOf } = setup([json(firstPage(['1'], 'c1')), json(laterPage(['2'], 'c2')), json(laterPage(['3']))])

    const first = await provider.search!('foo fighters')
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/)
    const second = await provider.search!('foo fighters', first.nextCursor)
    const third = await provider.search!('foo fighters', second.nextCursor)

    const later = urlOf(1)
    expect(later.pathname).toBe('/v2/searchResults/foo%20fighters/relationships/tracks')
    expect(later.searchParams.get('page[cursor]')).toBe('c1')
    expect(urlOf(2).searchParams.get('page[cursor]')).toBe('c2')
    expect([second, third].map((page) => page.tracks.map((track) => track.id))).toEqual([['2'], ['3']])
    expect(third.nextCursor).toBeUndefined()
  })

  it('refuses nothing to search for, a search that is too long, and a cursor that is not its own', async () => {
    const { provider, fetchFn } = setup([])
    await expect(provider.search!('   ')).rejects.toThrow('Type something to search for.')
    await expect(provider.search!('x'.repeat(201))).rejects.toThrow('Type something to search for.')
    for (const bad of ['not a cursor', 'e30', Buffer.from('["id"]').toString('base64url'), Buffer.from('[1,2]').toString('base64url')]) {
      await expect(provider.search!('foo', bad)).rejects.toThrow('Invalid library cursor')
    }
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('uses the short list of related things when TIDAL refuses the long one', async () => {
    const { provider, urlOf } = setup([json({ errors: [{ status: '400', detail: 'Unsupported include' }] }, { status: 400 }), json(firstPage(['1']))])
    expect((await provider.search!('foo')).tracks).toHaveLength(1)
    expect(urlOf(1).searchParams.get('include')).toBe('tracks')
  })

  it('asks to reconnect, without calling TIDAL, when the grant cannot search', async () => {
    const { provider, fetchFn } = setup([], false)
    await expect(provider.search!('foo')).rejects.toThrow(/Reconnect TIDAL/)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('copes with a search that finds nothing', async () => {
    const { provider } = setup([json({ data: [] })])
    expect(await provider.search!('zzzz')).toEqual({ tracks: [], nextCursor: undefined })
  })
})

describe('TIDAL saving songs', () => {
  it('adds a track to the collection with a JSON:API body', async () => {
    const { provider, urlOf, initOf } = setup([new Response(null, { status: 200 })])

    await provider.saveTrack!('4321')

    expect(urlOf(0).pathname).toBe('/v2/userCollectionTracks/me/relationships/items')
    expect(initOf(0).method).toBe('POST')
    expect(initOf(0).headers).toMatchObject({ 'Content-Type': 'application/vnd.api+json', Authorization: 'Bearer token-1' })
    expect(JSON.parse(String(initOf(0).body))).toEqual({ data: [{ id: '4321', type: 'tracks' }] })
  })

  it('removes one with the same body, using DELETE', async () => {
    const { provider, initOf } = setup([new Response(null, { status: 200 })])
    await provider.unsaveTrack!('4321')
    expect(initOf(0).method).toBe('DELETE')
    expect(JSON.parse(String(initOf(0).body))).toEqual({ data: [{ id: '4321', type: 'tracks' }] })
  })

  it('does not call it a failure to add a track that is already there, or to remove one that already is not', async () => {
    const conflict = setup([json({ errors: [{ status: '409', detail: 'Already in collection' }] }, { status: 409 })])
    await expect(conflict.provider.saveTrack!('1')).resolves.toBeUndefined()

    const missing = setup([json({ errors: [{ status: '404', detail: 'Not found' }] }, { status: 404 })])
    await expect(missing.provider.unsaveTrack!('1')).resolves.toBeUndefined()
  })

  it('still reports a conflict on removing, a missing track on adding, and every other failure', async () => {
    const a = setup([json({ errors: [{ status: '409', detail: 'Busy' }] }, { status: 409 })])
    await expect(a.provider.unsaveTrack!('1')).rejects.toThrow('TIDAL: Busy (status 409)')
    const b = setup([json({ errors: [{ status: '404', detail: 'No such track' }] }, { status: 404 })])
    await expect(b.provider.saveTrack!('1')).rejects.toThrow('TIDAL: No such track (status 404)')
    const c = setup([json({ errors: [{ status: '403', detail: 'Not allowed' }] }, { status: 403 })])
    await expect(c.provider.saveTrack!('1')).rejects.toThrow('TIDAL: Not allowed (status 403)')
  })

  it('refuses an id that could alter the request, and a grant that cannot write, without calling TIDAL', async () => {
    const { provider, fetchFn } = setup([])
    for (const bad of ['', 'a/b', '1 2', 'x'.repeat(65), '../me']) await expect(provider.saveTrack!(bad)).rejects.toThrow('That is not a valid TIDAL track.')
    expect(fetchFn).not.toHaveBeenCalled()

    const limited = setup([], false)
    await expect(limited.provider.saveTrack!('1')).rejects.toThrow(/Reconnect TIDAL/)
    expect(limited.fetchFn).not.toHaveBeenCalled()
  })

  it('is offered to the app as search and saving', () => {
    const { provider } = setup([])
    expect([typeof provider.search, typeof provider.saveTrack, typeof provider.unsaveTrack]).toEqual(['function', 'function', 'function'])
  })
})
