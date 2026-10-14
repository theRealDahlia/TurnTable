import { describe, expect, it, vi } from 'vitest'
import { AuthRequiredError, type OAuthSession } from '../src/main/auth/session'
import { createTidalProvider } from '../src/main/providers/tidal/provider'
import { Included, nextCursorOf, toTrack } from '../src/main/providers/tidal/jsonapi'

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/vnd.api+json' }, ...init })

/** A library page the way TIDAL's API describes it: identifiers in `data`, the resources they point at in `included`. */
function page(options: { ids?: string[]; next?: string; withLinks?: boolean } = {}) {
  const ids = options.ids ?? ['100', '101']
  return {
    data: ids.map((id, i) => ({ id, type: 'tracks', meta: { addedAt: `2026-02-0${i + 1}T10:00:00Z` } })),
    included: [
      ...ids.map((id) => ({
        id,
        type: 'tracks',
        attributes: { title: `Song ${id}`, duration: 'PT3M5S', availability: ['STREAM', 'DJ'], externalLinks: [{ href: `https://tidal.com/track/${id}`, meta: { type: 'TIDAL_SHARING' } }] },
        relationships: { artists: { data: [{ id: 'a1', type: 'artists' }, { id: 'a2', type: 'artists' }] }, albums: { data: [{ id: 'al1', type: 'albums' }] } }
      })),
      { id: 'a1', type: 'artists', attributes: { name: 'Foo Fighters' } },
      { id: 'a2', type: 'artists', attributes: { name: 'Guest' } },
      { id: 'al1', type: 'albums', attributes: { title: 'The Colour and the Shape' }, relationships: { coverArt: { data: [{ id: 'art1', type: 'artworks' }] } } },
      {
        id: 'art1',
        type: 'artworks',
        attributes: {
          files: [
            { href: 'https://resources.tidal.com/80.jpg', meta: { width: 80, height: 80 } },
            { href: 'https://resources.tidal.com/320.jpg', meta: { width: 320, height: 320 } },
            { href: 'https://resources.tidal.com/1280.jpg', meta: { width: 1280, height: 1280 } }
          ]
        }
      }
    ],
    links: { self: '/x', ...(options.next ? { next: `/userCollectionTracks/me/relationships/items?page%5Bcursor%5D=${options.next}`, meta: { nextCursor: options.next } } : {}) }
  }
}

function setup(responses: (Response | (() => Response))[], extra: { granted?: boolean; now?: () => number; minIntervalMs?: number } = {}) {
  const session = {
    getAccessToken: vi.fn().mockResolvedValue('token-1'),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockResolvedValue(true),
    hasScopes: vi.fn().mockResolvedValue(extra.granted ?? true),
    connect: vi.fn()
  }
  const queue = [...responses]
  const fetchFn = vi.fn(async () => {
    const next = queue.shift()
    return typeof next === 'function' ? next() : (next ?? json(page()))
  })
  const sleep = vi.fn().mockResolvedValue(undefined)
  const provider = createTidalProvider(session as unknown as OAuthSession, { fetch: fetchFn as unknown as typeof fetch, sleep, now: extra.now, minIntervalMs: extra.minIntervalMs })
  const urlOf = (call: number): URL => new URL(String((fetchFn.mock.calls[call] as unknown[])[0]))
  return { session, fetchFn, sleep, provider, urlOf }
}

describe('TIDAL saved tracks', () => {
  it('asks for the collection, newest first, with artists, albums and cover art along with it, as the signed-in user', async () => {
    const { provider, fetchFn, urlOf } = setup([json(page())])

    await provider.getSavedTracks()

    const url = urlOf(0)
    expect(url.origin + url.pathname).toBe('https://openapi.tidal.com/v2/userCollectionTracks/me/relationships/items')
    expect(url.searchParams.get('include')).toBe('items,items.artists,items.albums,items.albums.coverArt')
    expect(url.searchParams.get('sort')).toBe('-addedAt')
    expect(url.searchParams.has('page[cursor]')).toBe(false)
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token-1', Accept: 'application/vnd.api+json' })
  })

  it('maps tracks, with artists, album, sharp artwork, the date saved, and a link back to TIDAL', async () => {
    const { provider } = setup([json(page({ ids: ['100'] }))])

    const { tracks, nextCursor } = await provider.getSavedTracks()

    expect(tracks).toEqual([
      {
        id: '100',
        providerId: 'tidal',
        title: 'Song 100',
        artists: ['Foo Fighters', 'Guest'],
        artistIds: ['a1', 'a2'],
        album: 'The Colour and the Shape',
        albumId: 'al1',
        durationMs: 185_000,
        artworkUrl: 'https://resources.tidal.com/320.jpg',
        url: 'https://tidal.com/track/100',
        savedAt: '2026-02-01T10:00:00Z'
      }
    ])
    expect(nextCursor).toBeUndefined()
  })

  it("follows TIDAL's own cursor to the next page", async () => {
    const { provider, urlOf } = setup([json(page({ next: 'abc123' })), json(page({ ids: ['200'] }))])

    const first = await provider.getSavedTracks()
    expect(first.nextCursor).toBe('abc123')
    const second = await provider.getSavedTracks(first.nextCursor)

    expect(urlOf(1).searchParams.get('page[cursor]')).toBe('abc123')
    expect(second.tracks.map((track) => track.id)).toEqual(['200'])
    expect(second.nextCursor).toBeUndefined()
  })

  it('refuses a cursor that could alter the request', async () => {
    const { provider, fetchFn } = setup([])
    for (const bad of ['', 'a b', 'x'.repeat(501), 'line\nbreak']) await expect(provider.getSavedTracks(bad)).rejects.toThrow('Invalid library cursor')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('uses the short list of related things if TIDAL refuses the long one, and keeps using it', async () => {
    const refused = (): Response => json({ errors: [{ status: '400', detail: 'Unsupported include: items.albums.coverArt' }] }, { status: 400 })
    const { provider, urlOf } = setup([refused, json(page()), json(page())])

    expect((await provider.getSavedTracks()).tracks).toHaveLength(2)
    await provider.getSavedTracks()

    expect(urlOf(1).searchParams.get('include')).toBe('items')
    expect(urlOf(2).searchParams.get('include')).toBe('items')
  })

  it('shows the message TIDAL gave, without control characters, capped in length', async () => {
    const { provider } = setup([json({ errors: [{ status: '403', detail: `Not allowed\u0007 here ${'x'.repeat(400)}` }] }, { status: 403 })])
    const error = (await provider.getSavedTracks().catch((e: unknown) => e)) as Error
    expect(error.message).toMatch(/^TIDAL: Not allowed {1,2}here x+ \(status 403\)$/)
    expect(error.message.length).toBeLessThan(260)
  })

  it('falls back to the status when TIDAL gives no explanation', async () => {
    // 501 is not one of the passing server errors that are asked again.
    const { provider } = setup([new Response('oops', { status: 501 })])
    await expect(provider.getSavedTracks()).rejects.toThrow('TIDAL request failed with status 501')
  })

  it('asks again after a pause when TIDAL answers a read with a passing server error, and gives up after the third try', async () => {
    const recovers = setup([new Response('busy', { status: 503 }), json(page({ ids: ['100'] }))])
    expect((await recovers.provider.getSavedTracks()).tracks.map((t) => t.id)).toEqual(['100'])
    expect(recovers.sleep.mock.calls.map(([ms]) => ms)).toEqual([2000])

    const down = setup([new Response('bad', { status: 502 }), new Response('bad', { status: 502 }), new Response('bad', { status: 502 })])
    await expect(down.provider.getSavedTracks()).rejects.toThrow('TIDAL request failed with status 502')
    expect(down.fetchFn).toHaveBeenCalledTimes(3)
  })

  it('never asks again for a change to the collection', async () => {
    const { provider, fetchFn } = setup([new Response('bad', { status: 502 })])
    await expect(provider.saveTrack!('100')).rejects.toThrow('TIDAL request failed with status 502')
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('asks to reconnect when the grant lacks the collection permission, without calling TIDAL', async () => {
    const { provider, fetchFn } = setup([], { granted: false })
    await expect(provider.getSavedTracks()).rejects.toThrow(/Reconnect TIDAL/)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  describe('signing in again', () => {
    it('retries once with a refreshed token after a 401', async () => {
      const { provider, session, fetchFn } = setup([new Response(null, { status: 401 }), json(page())])
      expect((await provider.getSavedTracks()).tracks).toHaveLength(2)
      expect(session.getAccessToken).toHaveBeenNthCalledWith(1, { forceRefresh: false })
      expect(session.getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true })
      expect(fetchFn).toHaveBeenCalledTimes(2)
    })

    it('signs the user out when a refreshed token is still rejected', async () => {
      const { provider, session } = setup([new Response(null, { status: 401 }), new Response(null, { status: 401 })])
      await expect(provider.getSavedTracks()).rejects.toBeInstanceOf(AuthRequiredError)
      expect(session.disconnect).toHaveBeenCalledOnce()
    })
  })

  describe('when TIDAL says to slow down', () => {
    const limited = (retryAfter?: string): Response => new Response(null, { status: 429, headers: retryAfter ? { 'Retry-After': retryAfter } : {} })

    it('stops at the first refusal, sends nothing more until the wait is over, then carries on', async () => {
      let time = 1_000_000
      const { provider, fetchFn, sleep } = setup([limited('90'), json(page())], { now: () => time })

      await expect(provider.getSavedTracks()).rejects.toThrow(/rate limit.*in about 2 minutes/)
      await expect(provider.getSavedTracks()).rejects.toThrow('rate limit')
      expect(fetchFn).toHaveBeenCalledOnce()
      expect(sleep).not.toHaveBeenCalled()

      time += 90_001
      expect((await provider.getSavedTracks()).tracks).toHaveLength(2)
      expect(fetchFn).toHaveBeenCalledTimes(2)
    })

    it('still stops, for a default time, when TIDAL does not say for how long', async () => {
      let time = 1_000_000
      const { provider, fetchFn } = setup([limited(), json(page())], { now: () => time })
      await expect(provider.getSavedTracks()).rejects.toThrow('rate limit')
      time += 29_000
      await expect(provider.getSavedTracks()).rejects.toThrow('rate limit')
      expect(fetchFn).toHaveBeenCalledOnce()
    })
  })

  describe('pacing', () => {
    it('spaces requests the interval apart', async () => {
      let clock = 1_000_000
      const { provider, sleep } = setup([json(page()), json(page())], { now: () => clock, minIntervalMs: 500 })
      await provider.getSavedTracks()
      await provider.getSavedTracks()
      expect(sleep).toHaveBeenCalledExactlyOnceWith(500)
      clock += 1
    })
  })
})

describe('TIDAL JSON:API reading', () => {
  const included = (resources: unknown[]): Included => new Included(resources)

  it('skips tracks it has nothing to show for, and ids that could alter a URL', () => {
    const resources = [{ id: '1', type: 'tracks', attributes: { title: 'Fine' } }, { id: '2', type: 'tracks', attributes: {} }]
    expect(toTrack({ id: '1', type: 'tracks' }, included(resources))?.title).toBe('Fine')
    expect(toTrack({ id: '2', type: 'tracks' }, included(resources))).toBeUndefined()
    expect(toTrack({ id: '3', type: 'tracks' }, included(resources))).toBeUndefined()
    expect(toTrack({ id: '1/../me', type: 'tracks' }, included([{ id: '1/../me', type: 'tracks', attributes: { title: 'Bad' } }]))).toBeUndefined()
    expect(toTrack({ id: 5, type: 'tracks' }, included(resources))).toBeUndefined()
  })

  it('adds the version to the title, marks a track that cannot be streamed, and copes with nothing else known', () => {
    const track = toTrack({ id: '9', type: 'tracks' }, included([{ id: '9', type: 'tracks', attributes: { title: 'Everlong', version: 'Acoustic', availability: ['DJ'] } }]))
    expect(track).toMatchObject({ title: 'Everlong (Acoustic)', artists: [], playable: false, durationMs: 0, url: 'https://tidal.com/browse/track/9' })
    expect(track?.album).toBeUndefined()
    expect(track?.artworkUrl).toBeUndefined()
  })

  it('only keeps links to TIDAL itself, and artwork over https', () => {
    const resources = [
      { id: '1', type: 'tracks', attributes: { title: 'T', externalLinks: [{ href: 'https://evil.example/x' }, { href: 'javascript:void0' }] }, relationships: { albums: { data: [{ id: 'a', type: 'albums' }] } } },
      { id: 'a', type: 'albums', attributes: { title: 'A' }, relationships: { coverArt: { data: [{ id: 'c', type: 'artworks' }] } } },
      { id: 'c', type: 'artworks', attributes: { files: [{ href: 'http://insecure.example/a.jpg', meta: { width: 640, height: 640 } }] } }
    ]
    const track = toTrack({ id: '1', type: 'tracks' }, included(resources))
    expect(track?.url).toBe('https://tidal.com/browse/track/1')
    expect(track?.artworkUrl).toBeUndefined()
  })

  it('takes the next cursor from the meta, or else from the next link', () => {
    expect(nextCursorOf({ links: { meta: { nextCursor: 'abc' } } })).toBe('abc')
    expect(nextCursorOf({ links: { next: '/x?page%5Bcursor%5D=zzz' } })).toBe('zzz')
    expect(nextCursorOf({ links: { next: 'https://openapi.tidal.com/v2/x?page[cursor]=yyy&other=1' } })).toBe('yyy')
    expect(nextCursorOf({ links: {} })).toBeUndefined()
    expect(nextCursorOf({})).toBeUndefined()
  })
})
