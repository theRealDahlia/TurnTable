import { describe, expect, it } from 'vitest'
import type { Album, Track } from '@shared/types'
import { describeLength, kindName, releaseYear } from './describe'
import { albumOrder, localAlbums, localAlbumTracks } from './localAlbums'

const file = (id: string, overrides: Partial<Track> = {}): Track => ({ id, providerId: 'local', title: `Song ${id}`, artists: ['Foo Fighters'], album: 'The Colour and the Shape', durationMs: 1000, ...overrides })

describe('localAlbums', () => {
  const library = [
    file('1', { trackNumber: 2, artworkUrl: undefined }),
    file('2', { trackNumber: 1, artworkUrl: 'turntable-media://art/2' }),
    file('3', { album: 'the colour and the shape', trackNumber: 3 }),
    file('4', { album: 'Wasting Light' }),
    file('5', { album: undefined }),
    file('6', { artists: ['Nirvana'], album: 'Nevermind' }),
    file('7', { providerId: 'spotify', album: 'Sonic Highways' })
  ]

  it("groups the artist's own files into albums by title, ignoring case, with the first cover found", () => {
    const albums = localAlbums(library, 'foo fighters')
    expect(albums.map((album) => [album.title, album.trackCount, album.artworkUrl])).toEqual([
      ['The Colour and the Shape', 3, 'turntable-media://art/2'],
      ['Wasting Light', 1, undefined]
    ])
    expect(albums.every((album) => album.providerId === 'local' && album.artists[0] === 'foo fighters')).toBe(true)
  })

  it("lists an album's files in disc and track order, then by title", () => {
    const [colour] = localAlbums(library, 'Foo Fighters')
    expect(localAlbumTracks(library, colour!).map((t) => t.id)).toEqual(['2', '1', '3'])
  })

  it('puts numbered tracks before unnumbered ones, and discs in order', () => {
    const tracks = [file('a', { title: 'B' }), file('b', { discNumber: 2, trackNumber: 1 }), file('c', { discNumber: 1, trackNumber: 9 }), file('d', { title: 'A' })]
    expect([...tracks].sort(albumOrder).map((t) => t.id)).toEqual(['c', 'b', 'd', 'a'])
  })
})

describe('album descriptions', () => {
  const album = (overrides: Partial<Album> = {}): Album => ({ id: '1', providerId: 'tidal', title: 'X', artists: [], ...overrides })

  it('names the kind of release, calling it an album when the service does not say', () => {
    expect(kindName(album({ kind: 'ep' }))).toBe('EP')
    expect(kindName(album())).toBe('Album')
  })

  it('takes the year from any form of release date', () => {
    expect(releaseYear(album({ releaseDate: '1997-05-20' }))).toBe('1997')
    expect(releaseYear(album({ releaseDate: '1997' }))).toBe('1997')
    expect(releaseYear(album())).toBeUndefined()
  })

  it('describes how many songs and how long', () => {
    expect(describeLength(1, 200_000)).toBe('1 song, 3 min')
    expect(describeLength(13, 46 * 60_000)).toBe('13 songs, 46 min')
    expect(describeLength(30, 75 * 60_000)).toBe('30 songs, 1:15:00')
    expect(describeLength(2, 0)).toBe('2 songs')
  })
})
