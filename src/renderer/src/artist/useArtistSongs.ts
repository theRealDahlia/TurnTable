import { useEffect, useState } from 'react'
import { describeError } from '@shared/errors'
import type { ProviderId, Track } from '@shared/types'
import { hasArtist } from '../library/query'

/** An artist as one service names them. Services are never mixed, so the same name on two services is two artists. */
export interface Artist {
  providerId: ProviderId
  name: string
}

export const artistKey = (artist: Artist): string => `${artist.providerId}:${artist.name}`

export interface ArtistSongs {
  /** "idle" when the service can't be searched, so only the library can show this artist's songs. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Songs the service found that credit this artist, in the service's order. */
  tracks: Track[]
  error?: string
  /** There are more of the service's results to look through. */
  hasMore: boolean
  loadingMore: boolean
  /** Why the last attempt to look further failed, if it did. The songs already found stay. */
  moreError?: string
  loadMore(): void
  retry(): void
}

interface Found {
  key: string
  status: 'ready' | 'error'
  tracks: Track[]
  error?: string
  nextCursor?: string
  loadingMore: boolean
  moreError?: string
}

/** Adds the songs from `page` that credit the artist and aren't listed yet. */
const merge = (known: Track[], page: Track[], name: string): Track[] => {
  const seen = new Set(known.map((track) => track.id))
  const fresh: Track[] = []
  for (const track of page) {
    if (!hasArtist(track, name) || seen.has(track.id)) continue
    seen.add(track.id)
    fresh.push(track)
  }
  return fresh.length ? [...known, ...fresh] : known
}

/**
 * Finds an artist's songs by searching that one service for their name and keeping only the songs credited to them.
 * Uses the same search the Search page does, so it needs no other permission. More pages are fetched only when
 * asked, since a search can count against a service's daily allowance. Nothing is stored; results live in memory.
 */
export function useArtistSongs(artist: Artist | undefined, searchable: boolean): ArtistSongs {
  const [found, setFound] = useState<Found>()
  // Bumped to search again after a failure.
  const [attempt, setAttempt] = useState(0)
  const key = artist ? artistKey(artist) : undefined
  const providerId = artist?.providerId
  const name = artist?.name

  useEffect(() => {
    if (!key || !providerId || !name || !searchable) return
    let live = true
    window.turntable.searchTracks(providerId, name).then(
      (page) => live && setFound({ key, status: 'ready', tracks: merge([], page.tracks, name), nextCursor: page.nextCursor, loadingMore: false }),
      (error: unknown) => live && setFound({ key, status: 'error', tracks: [], error: describeError(error), loadingMore: false })
    )
    return () => {
      live = false
    }
  }, [key, providerId, name, searchable, attempt])

  const mine = found?.key === key ? found : undefined
  const status: ArtistSongs['status'] = !artist || !searchable ? 'idle' : (mine?.status ?? 'loading')

  const loadMore = (): void => {
    if (!artist || !mine || mine.status !== 'ready' || !mine.nextCursor || mine.loadingMore) return
    const { nextCursor } = mine
    const update = (change: (current: Found) => Found): void =>
      setFound((current) => (current?.key === mine.key && current.nextCursor === nextCursor ? change(current) : current))
    update((current) => ({ ...current, loadingMore: true, moreError: undefined }))
    window.turntable.searchTracks(artist.providerId, artist.name, nextCursor).then(
      (page) => update((current) => ({ ...current, tracks: merge(current.tracks, page.tracks, artist.name), nextCursor: page.nextCursor, loadingMore: false })),
      (error: unknown) => update((current) => ({ ...current, loadingMore: false, moreError: describeError(error) }))
    )
  }

  const retry = (): void => {
    if (mine?.status !== 'error') return
    setFound(undefined)
    setAttempt((count) => count + 1)
  }

  return {
    status,
    tracks: status === 'ready' && mine ? mine.tracks : [],
    error: status === 'error' ? mine?.error : undefined,
    hasMore: status === 'ready' && mine?.nextCursor !== undefined,
    loadingMore: mine?.loadingMore ?? false,
    moreError: mine?.moreError,
    loadMore,
    retry
  }
}
