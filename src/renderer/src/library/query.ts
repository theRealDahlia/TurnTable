import type { ProviderId, Track } from '@shared/types'

export type SortKey = 'recent' | 'title' | 'artist'

export interface LibraryFilter {
  query: string
  providerId?: ProviderId
}

/** Case- and accent-insensitive form used for matching. */
const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

const compareText = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })

/** Keeps tracks from the chosen service whose title, artists, or album contain every word of the query. */
export function filterTracks(tracks: Track[], { query, providerId }: LibraryFilter): Track[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  return tracks.filter((track) => {
    if (providerId && track.providerId !== providerId) return false
    if (words.length === 0) return true
    const haystack = fold([track.title, ...track.artists, track.album ?? ''].join(' '))
    return words.every((word) => haystack.includes(word))
  })
}

/** Returns a sorted copy. Tracks without a save date sort last under "recent". */
export function sortTracks(tracks: Track[], sort: SortKey): Track[] {
  const sorted = [...tracks]
  switch (sort) {
    case 'recent':
      return sorted.sort((a, b) => {
        if (a.savedAt === b.savedAt) return 0
        if (!a.savedAt) return 1
        if (!b.savedAt) return -1
        return a.savedAt < b.savedAt ? 1 : -1
      })
    case 'title':
      return sorted.sort((a, b) => compareText(a.title, b.title))
    case 'artist':
      return sorted.sort(
        (a, b) => compareText(a.artists[0] ?? '', b.artists[0] ?? '') || compareText(a.title, b.title)
      )
  }
}

/** How search results can be ordered. "relevance" keeps the order the service returned them in. */
export type ResultSortKey = 'relevance' | 'title' | 'artist' | 'album' | 'shortest' | 'longest'

/** Puts tracks that lack the value being sorted on last, so they don't crowd the top of the list. */
const missingLast = <T>(a: T | undefined, b: T | undefined, compare: (a: T, b: T) => number): number => {
  if (a === undefined) return b === undefined ? 0 : 1
  if (b === undefined) return -1
  return compare(a, b)
}

const knownDuration = (track: Track): number | undefined => (track.durationMs > 0 ? track.durationMs : undefined)

/**
 * Orders search results. "relevance" returns the same array untouched; every other order returns a sorted copy,
 * and ties keep the service's order.
 */
export function sortResults(tracks: Track[], sort: ResultSortKey): Track[] {
  switch (sort) {
    case 'relevance':
      return tracks
    case 'title':
    case 'artist':
      return sortTracks(tracks, sort)
    case 'album':
      return [...tracks].sort((a, b) => missingLast(a.album || undefined, b.album || undefined, compareText))
    case 'shortest':
      return [...tracks].sort((a, b) => missingLast(knownDuration(a), knownDuration(b), (x, y) => x - y))
    case 'longest':
      return [...tracks].sort((a, b) => missingLast(knownDuration(a), knownDuration(b), (x, y) => y - x))
  }
}

/** 185_000 -> "3:05", 3_725_000 -> "1:02:05". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}
