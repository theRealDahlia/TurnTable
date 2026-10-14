import { describe, expect, it, vi } from 'vitest'
import type { OAuthSession } from '../src/main/auth/session'
import { createSpotifyProvider } from '../src/main/providers/spotify/provider'

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })

const ARTIST = '0TnOYISbd1XYRBk9myaseg'
const ALBUM = '2noRn2Aes5aoNVsU6iWThc'
const TRACK = '4iV5W9uYEdYUVa79Axb7Rh'

function setup(responses: Response[]) {
  const session = { getAccessToken: vi.fn().mockResolvedValue('token-1'), disconnect: vi.fn(), isConnected: vi.fn(), connect: vi.fn(), hasScopes: vi.fn().mockResolvedValue(true) }
  const fetchFn = vi.fn()
  for (const response of responses) fetchFn.mockResolvedValueOnce(response)
  const provider = createSpotifyProvider(session as unknown as OAuthSession, { fetch: fetchFn as unknown as typeof fetch, sleep: vi.fn().mockResolvedValue(undefined), random: () => 0 })
  const urlOf = (call: number): URL => new URL(String((fetchFn.mock.calls[call] as unknown[])[0]))
  return { provider, fetchFn, urlOf }
}

const album = (id: string | null, overrides = {}) => ({
  id,
  name: `Album ${id}`,
  album_type: 'album',
  total_tracks: 11,
  release_date: '1997-05-20',
  images: [{ url: 'https://img/640', width: 640 }, { url: 'https://img/300', width: 300 }],
  artists: [{ name: 'Foo Fighters', id: ARTIST }],
  external_urls: { spotify: `https://open.spotify.com/album/${id}` },
  ...overrides
})

describe('Spotify artist albums', () => {
  it("asks for the artist's own albums, singles and compilations, ten at a time, and maps them", async () => {
    const { provider, urlOf } = setup([json({ items: [album(ALBUM)], next: 'https://api.spotify.com/v1/artists/x/albums?offset=10' })])

    const page = await provider.getArtistAlbums!(ARTIST)

    expect(urlOf(0).pathname).toBe(`/v1/artists/${ARTIST}/albums`)
    expect(Object.fromEntries(urlOf(0).searchParams)).toEqual({ include_groups: 'album,single,compilation', limit: '10', offset: '0' })
    expect(page).toEqual({
      albums: [
        {
          id: ALBUM,
          providerId: 'spotify',
          title: `Album ${ALBUM}`,
          artists: ['Foo Fighters'],
          artistIds: [ARTIST],
          artworkUrl: 'https://img/300',
          releaseDate: '1997-05-20',
          kind: 'album',
          trackCount: 11,
          url: `https://open.spotify.com/album/${ALBUM}`
        }
      ],
      nextCursor: '1'
    })
  })

  it('continues from the cursor, and stops on the last page', async () => {
    const { provider, urlOf } = setup([json({ items: [album(ALBUM)], next: null })])
    const page = await provider.getArtistAlbums!(ARTIST, '10')
    expect(urlOf(0).searchParams.get('offset')).toBe('10')
    expect(page.nextCursor).toBeUndefined()
  })

  it('leaves out albums with no usable id, and links that are not Spotify', async () => {
    const { provider } = setup([json({ items: [album(null), null, album('bad id'), album(ALBUM, { external_urls: { spotify: 'https://evil.example/' } })], next: null })])
    const { albums } = await provider.getArtistAlbums!(ARTIST)
    expect(albums.map((a) => a.id)).toEqual([ALBUM])
    expect(albums[0]?.url).toBeUndefined()
  })

  it('never builds a URL from an id that is not a Spotify id', async () => {
    const { provider, fetchFn } = setup([])
    await expect(provider.getArtistAlbums!('../me/tracks')).rejects.toThrow('That is not a valid Spotify artist.')
    await expect(provider.getAlbumTracks!('a b')).rejects.toThrow('That is not a valid Spotify album.')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('Spotify album tracks', () => {
  it("lists the album's tracks in order, fifty at a time, each marked as on this album", async () => {
    const tracks = [
      { id: TRACK, name: 'Everlong', duration_ms: 250_000, disc_number: 1, track_number: 11, artists: [{ name: 'Foo Fighters', id: ARTIST }] },
      { id: null, name: 'Gone', duration_ms: 1, artists: [] }
    ]
    const { provider, urlOf } = setup([json({ items: tracks, next: 'https://api.spotify.com/v1/albums/x/tracks?offset=50' })])

    const page = await provider.getAlbumTracks!(ALBUM)

    expect(urlOf(0).pathname).toBe(`/v1/albums/${ALBUM}/tracks`)
    expect(Object.fromEntries(urlOf(0).searchParams)).toEqual({ limit: '50', offset: '0' })
    expect(page.tracks).toEqual([
      { id: TRACK, providerId: 'spotify', title: 'Everlong', artists: ['Foo Fighters'], artistIds: [ARTIST], albumId: ALBUM, discNumber: 1, trackNumber: 11, durationMs: 250_000 }
    ])
    expect(page.nextCursor).toBe('2')
  })
})
