import { describe, expect, it } from 'vitest'
import type { Track } from '@shared/types'
import { filterTracks, formatDuration, sortTracks } from './query'

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
