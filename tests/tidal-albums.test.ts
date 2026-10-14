import { describe, expect, it, vi } from 'vitest'
import type { OAuthSession } from '../src/main/auth/session'
import { createTidalProvider } from '../src/main/providers/tidal/provider'

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/vnd.api+json' }, ...init })

function setup(responses: Response[]) {
  const session = { getAccessToken: vi.fn().mockResolvedValue('token-1'), disconnect: vi.fn(), isConnected: vi.fn().mockResolvedValue(true), hasScopes: vi.fn().mockResolvedValue(true), connect: vi.fn() }
  const fetchFn = vi.fn()
  for (const response of responses) fetchFn.mockResolvedValueOnce(response)
  const provider = createTidalProvider(session as unknown as OAuthSession, { fetch: fetchFn as unknown as typeof fetch, sleep: vi.fn().mockResolvedValue(undefined) })
  const urlOf = (call: number): URL => new URL(String((fetchFn.mock.calls[call] as unknown[])[0]))
  return { provider, fetchFn, urlOf }
}

const artwork = { id: 'art1', type: 'artworks', attributes: { files: [{ href: 'https://resources.tidal.com/320.jpg', meta: { width: 320 } }] } }

const albumsDocument = (next?: string) => ({
  data: [
    { id: '58990486', type: 'albums' },
    { id: 'missing', type: 'albums' }
  ],
  included: [
    {
      id: '58990486',
      type: 'albums',
      attributes: { title: 'The Colour and the Shape', releaseDate: '1997-05-20', albumType: 'ALBUM', numberOfItems: 13, externalLinks: [{ href: 'https://tidal.com/browse/album/58990486' }] },
      relationships: { coverArt: { data: [{ id: 'art1', type: 'artworks' }] }, artists: { data: [{ id: 'a1', type: 'artists' }] } }
    },
    { id: 'a1', type: 'artists', attributes: { name: 'Foo Fighters' } },
    artwork
  ],
  links: next ? { next: `/artists/a1/relationships/albums?page%5Bcursor%5D=${next}` } : {}
})

describe('TIDAL artist albums', () => {
  it("asks for the artist's albums with their cover art and artists, and maps them", async () => {
    const { provider, urlOf } = setup([json(albumsDocument('c2'))])

    const page = await provider.getArtistAlbums!('a1')

    expect(urlOf(0).pathname).toBe('/v2/artists/a1/relationships/albums')
    expect(urlOf(0).searchParams.get('include')).toBe('albums,albums.coverArt,albums.artists')
    expect(page).toEqual({
      albums: [
        {
          id: '58990486',
          providerId: 'tidal',
          title: 'The Colour and the Shape',
          artists: ['Foo Fighters'],
          artistIds: ['a1'],
          artworkUrl: 'https://resources.tidal.com/320.jpg',
          releaseDate: '1997-05-20',
          kind: 'album',
          trackCount: 13,
          url: 'https://tidal.com/browse/album/58990486'
        }
      ],
      nextCursor: 'c2'
    })
  })

  it("follows TIDAL's cursor", async () => {
    const { provider, urlOf } = setup([json(albumsDocument())])
    await provider.getArtistAlbums!('a1', 'c2')
    expect(urlOf(0).searchParams.get('page[cursor]')).toBe('c2')
  })

  it('falls back to the albums alone if TIDAL refuses the longer list of related things', async () => {
    const refused = json({ errors: [{ detail: 'Unsupported include' }] }, { status: 400 })
    const { provider, urlOf } = setup([refused, json(albumsDocument())])
    expect((await provider.getArtistAlbums!('a1')).albums).toHaveLength(1)
    expect(urlOf(1).searchParams.get('include')).toBe('albums')
  })

  it('never builds a URL from an id or cursor that is not plain', async () => {
    const { provider, fetchFn } = setup([])
    await expect(provider.getArtistAlbums!('../x')).rejects.toThrow('That is not a valid TIDAL artist.')
    await expect(provider.getAlbumTracks!('a b')).rejects.toThrow('That is not a valid TIDAL album.')
    await expect(provider.getAlbumTracks!('1', 'a b')).rejects.toThrow('Invalid library cursor')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('TIDAL album tracks', () => {
  it("lists the album's tracks in order with their disc and track numbers, and leaves out videos", async () => {
    const document = {
      data: [
        { id: '1', type: 'tracks', meta: { volumeNumber: 1, trackNumber: 1 } },
        { id: 'v1', type: 'videos', meta: { volumeNumber: 1, trackNumber: 2 } },
        { id: '2', type: 'tracks', meta: { volumeNumber: 2, trackNumber: 1 } }
      ],
      included: [
        { id: '1', type: 'tracks', attributes: { title: 'Doll', duration: 'PT1M23S' }, relationships: { artists: { data: [{ id: 'a1', type: 'artists' }] } } },
        { id: '2', type: 'tracks', attributes: { title: 'Monkey Wrench', duration: 'PT3M51S' }, relationships: { artists: { data: [{ id: 'a1', type: 'artists' }] } } },
        { id: 'a1', type: 'artists', attributes: { name: 'Foo Fighters' } }
      ],
      links: {}
    }
    const { provider, urlOf } = setup([json(document)])

    const page = await provider.getAlbumTracks!('58990486')

    expect(urlOf(0).pathname).toBe('/v2/albums/58990486/relationships/items')
    expect(urlOf(0).searchParams.get('include')).toBe('items,items.artists,items.albums,items.albums.coverArt')
    expect(page.tracks.map((t) => [t.id, t.title, t.discNumber, t.trackNumber, t.albumId, t.artistIds])).toEqual([
      ['1', 'Doll', 1, 1, '58990486', ['a1']],
      ['2', 'Monkey Wrench', 2, 1, '58990486', ['a1']]
    ])
    expect(page.nextCursor).toBeUndefined()
  })
})
