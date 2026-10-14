import { describe, expect, it } from 'vitest'
import type { Track } from '@shared/types'
import { filterTracks, formatDuration, hasArtist, sortResults, sortTracks, tracksByArtist } from './query'

const track = (overrides: Partial<Track>): Track => ({
  id: 'id',
  providerId: 'spotify',
  title: 'Title',
  artists: ['Artist'],
  durationMs: 1000,
  ...overrides
})

const tracks: Track[] = [
  track({ id: '1', title: 'Blue in Green', artists: ['Miles Davis'], album: 'Kind of Blue', savedAt: '2026-01-01T00:00:00Z' }),
  track({ id: '2', title: 'Café del Mar', artists: ['Energy 52'], providerId: 'qobuz', savedAt: '2026-03-01T00:00:00Z' }),
  track({ id: '3', title: 'Autumn Leaves', artists: ['Bill Evans', 'Scott LaFaro'], album: 'Portrait in Jazz' }),
  track({ id: '4', title: 'Track 10', artists: ['Zed'], savedAt: '2026-02-01T00:00:00Z' }),
  track({ id: '5', title: 'Track 2', artists: ['Zed'], savedAt: '2026-02-01T00:00:00Z' })
]

const ids = (list: Track[]): string[] => list.map((t) => t.id)

describe('filterTracks', () => {
  it('returns everything for an empty or whitespace query', () => {
    expect(filterTracks(tracks, { query: '' })).toHaveLength(5)
    expect(filterTracks(tracks, { query: '   ' })).toHaveLength(5)
  })

  it('matches title, any artist, and album, ignoring case', () => {
    expect(ids(filterTracks(tracks, { query: 'BLUE' }))).toEqual(['1'])
    expect(ids(filterTracks(tracks, { query: 'lafaro' }))).toEqual(['3'])
    expect(ids(filterTracks(tracks, { query: 'portrait' }))).toEqual(['3'])
  })

  it('ignores accents in both directions', () => {
    expect(ids(filterTracks(tracks, { query: 'cafe' }))).toEqual(['2'])
    expect(ids(filterTracks([track({ id: 'x', title: 'Cafe' })], { query: 'café' }))).toEqual(['x'])
  })

  it('requires every word to match, in any order and across fields', () => {
    expect(ids(filterTracks(tracks, { query: 'davis blue' }))).toEqual(['1'])
    expect(filterTracks(tracks, { query: 'davis leaves' })).toEqual([])
  })

  it('filters by service, alone or with a query', () => {
    expect(ids(filterTracks(tracks, { query: '', providerId: 'qobuz' }))).toEqual(['2'])
    expect(filterTracks(tracks, { query: 'blue', providerId: 'qobuz' })).toEqual([])
  })

  it('treats regex characters in the query literally', () => {
    expect(filterTracks(tracks, { query: '.*' })).toEqual([])
    expect(filterTracks(tracks, { query: '(' })).toEqual([])
  })
})

describe('sortTracks', () => {
  it('sorts newest saved first, with undated tracks last', () => {
    expect(ids(sortTracks(tracks, 'recent'))).toEqual(['2', '4', '5', '1', '3'])
  })

  it('sorts by title, comparing numbers naturally and ignoring case', () => {
    expect(ids(sortTracks(tracks, 'title'))).toEqual(['3', '1', '2', '5', '4'])
  })

  it('sorts by first artist, then title', () => {
    expect(ids(sortTracks(tracks, 'artist'))).toEqual(['3', '2', '1', '5', '4'])
  })

  it('does not mutate its input', () => {
    const before = ids(tracks)
    sortTracks(tracks, 'title')
    expect(ids(tracks)).toEqual(before)
  })

  it('copes with tracks that have no artists', () => {
    const result = sortTracks([track({ id: 'a', artists: [] }), track({ id: 'b', artists: ['A'] })], 'artist')
    expect(ids(result)).toEqual(['a', 'b'])
  })
})

describe('hasArtist and tracksByArtist', () => {
  it('matches any one of the artists, ignoring case, accents and stray spaces', () => {
    expect(hasArtist(tracks[2]!, 'scott lafaro')).toBe(true)
    expect(hasArtist(track({ artists: ['Beyoncé'] }), ' BEYONCE ')).toBe(true)
  })

  it('needs the whole name, not part of it, and never matches an empty name', () => {
    expect(hasArtist(tracks[0]!, 'Miles')).toBe(false)
    expect(hasArtist(tracks[0]!, '  ')).toBe(false)
  })

  it("keeps one service's tracks by the artist, in order", () => {
    const mixed = [...tracks, track({ id: '6', artists: ['Zed'], providerId: 'tidal' })]
    expect(ids(tracksByArtist(mixed, 'zed', 'spotify'))).toEqual(['4', '5'])
    expect(ids(tracksByArtist(mixed, 'Zed', 'tidal'))).toEqual(['6'])
  })
})

describe('sortResults', () => {
  const results: Track[] = [
    track({ id: 'a', title: 'Night Ferry', artists: ['North Pier'], album: 'Undertow', durationMs: 240_000 }),
    track({ id: 'b', title: 'Blue Hour', artists: ['Ana Veliz'], durationMs: 0 }),
    track({ id: 'c', title: 'Álbum 2', artists: ['kofi'], album: 'afterglow', durationMs: 180_000 }),
    track({ id: 'd', title: 'Álbum 10', artists: ['Kofi'], album: '', durationMs: 300_000 })
  ]

  it('keeps the order the service returned for "best match", without copying', () => {
    expect(sortResults(results, 'relevance')).toBe(results)
  })

  it('sorts by title and by artist like the library does', () => {
    expect(ids(sortResults(results, 'title'))).toEqual(['c', 'd', 'b', 'a'])
    expect(ids(sortResults(results, 'artist'))).toEqual(['b', 'c', 'd', 'a'])
  })

  it('sorts by album, ignoring case, with tracks that have none last in their original order', () => {
    expect(ids(sortResults(results, 'album'))).toEqual(['c', 'a', 'b', 'd'])
  })

  it('sorts by length either way, with unknown lengths last', () => {
    expect(ids(sortResults(results, 'shortest'))).toEqual(['c', 'a', 'd', 'b'])
    expect(ids(sortResults(results, 'longest'))).toEqual(['d', 'a', 'c', 'b'])
  })

  it('never changes the list it was given', () => {
    const before = ids(results)
    for (const key of ['title', 'artist', 'album', 'shortest', 'longest'] as const) sortResults(results, key)
    expect(ids(results)).toEqual(before)
  })
})

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [999, '0:01'],
    [59_400, '0:59'],
    [185_000, '3:05'],
    [600_000, '10:00'],
    [3_725_000, '1:02:05'],
    [-5, '0:00']
  ])('formats %i ms as %s', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected)
  })
})
