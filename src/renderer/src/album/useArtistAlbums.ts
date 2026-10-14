import { useEffect, useState } from 'react'
import { describeError } from '@shared/errors'
import type { Album, ProviderId } from '@shared/types'

export interface ArtistAlbums {
  /** "idle" when there is nothing to ask: the service has no albums, or the artist's id on it is unknown. */
  status: 'idle' | 'loading' | 'ready' | 'error'
  albums: Album[]
  error?: string
  hasMore: boolean
  loadingMore: boolean
  moreError?: string
  loadMore(): void
  retry(): void
}

interface Found {
  key: string
  status: 'ready' | 'error'
  albums: Album[]
  error?: string
  nextCursor?: string
  loadingMore: boolean
  moreError?: string
}

const merge = (known: Album[], page: Album[]): Album[] => {
  const seen = new Set(known.map((album) => album.id))
  const fresh = page.filter((album) => !seen.has(album.id))
  return fresh.length ? [...known, ...fresh] : known
}

/**
 * An artist's albums on one service, a page at a time. The first page is fetched when the artist page opens; more
 * only when asked (as the end of the row is scrolled into view), so a long discography costs nothing unless browsed.
 */
export function useArtistAlbums(providerId: ProviderId, artistId: string | undefined, enabled: boolean): ArtistAlbums {
  const [found, setFound] = useState<Found>()
  const [attempt, setAttempt] = useState(0)
  const key = enabled && artistId ? `${providerId}:${artistId}` : undefined

  useEffect(() => {
    if (!key || !artistId) return
    let live = true
    window.turntable.getArtistAlbums(providerId, artistId).then(
      (page) => live && setFound({ key, status: 'ready', albums: merge([], page.albums), nextCursor: page.nextCursor, loadingMore: false }),
      (error: unknown) => live && setFound({ key, status: 'error', albums: [], error: describeError(error), loadingMore: false })
    )
    return () => {
      live = false
    }
  }, [key, providerId, artistId, attempt])

  const mine = key && found?.key === key ? found : undefined
  const status: ArtistAlbums['status'] = !key ? 'idle' : (mine?.status ?? 'loading')

  const loadMore = (): void => {
    if (!artistId || !mine || mine.status !== 'ready' || !mine.nextCursor || mine.loadingMore) return
    const { nextCursor } = mine
    const update = (change: (current: Found) => Found): void =>
      setFound((current) => (current?.key === mine.key && current.nextCursor === nextCursor ? change(current) : current))
    update((current) => ({ ...current, loadingMore: true, moreError: undefined }))
    window.turntable.getArtistAlbums(providerId, artistId, nextCursor).then(
      (page) => update((current) => ({ ...current, albums: merge(current.albums, page.albums), nextCursor: page.nextCursor, loadingMore: false })),
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
    albums: status === 'ready' && mine ? mine.albums : [],
    error: status === 'error' ? mine?.error : undefined,
    hasMore: status === 'ready' && mine?.nextCursor !== undefined,
    loadingMore: mine?.loadingMore ?? false,
    moreError: mine?.moreError,
    loadMore,
    retry
  }
}
