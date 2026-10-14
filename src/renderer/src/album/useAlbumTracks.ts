import { useEffect, useState } from 'react'
import { describeError } from '@shared/errors'
import type { Album, Track } from '@shared/types'

/** An album is fetched whole, so it plays in full; this caps it should a service keep handing back more pages. */
export const MAX_ALBUM_PAGES = 20

export interface AlbumTracks {
  status: 'loading' | 'ready' | 'error'
  tracks: Track[]
  error?: string
  retry(): void
}

interface Found {
  key: string
  status: 'ready' | 'error'
  tracks: Track[]
  error?: string
}

/** Fills in what an album's own track list leaves out of each track: the album and its cover. */
export const onAlbum = (track: Track, album: Pick<Album, 'id' | 'title' | 'artworkUrl'>): Track => ({
  ...track,
  album: track.album ?? album.title,
  albumId: track.albumId ?? album.id,
  artworkUrl: track.artworkUrl ?? album.artworkUrl
})

/**
 * All of an album's tracks, in album order, fetched page after page when the album opens. Kept in memory only.
 * With `enabled` false nothing is fetched (local files, whose albums are already in the library).
 */
export function useAlbumTracks(album: Album, enabled = true): AlbumTracks {
  const [found, setFound] = useState<Found>()
  const [attempt, setAttempt] = useState(0)
  // The effect depends on these values rather than on the album object, so a new but equal object fetches nothing.
  const { providerId, id, title, artworkUrl } = album
  const key = `${providerId}:${id}`

  useEffect(() => {
    if (!enabled) return
    let live = true
    const load = async (): Promise<void> => {
      const tracks: Track[] = []
      let cursor: string | undefined
      try {
        for (let pages = 0; pages < MAX_ALBUM_PAGES; pages++) {
          const page = await window.turntable.getAlbumTracks(providerId, id, cursor)
          if (!live) return
          tracks.push(...page.tracks.map((track) => onAlbum(track, { id, title, artworkUrl })))
          cursor = page.nextCursor
          if (!cursor) break
        }
        setFound({ key, status: 'ready', tracks })
      } catch (error) {
        if (live) setFound({ key, status: 'error', tracks: [], error: describeError(error) })
      }
    }
    void load()
    return () => {
      live = false
    }
  }, [key, providerId, id, title, artworkUrl, enabled, attempt])

  const mine = found?.key === key ? found : undefined
  return {
    status: enabled ? (mine?.status ?? 'loading') : 'ready',
    tracks: mine?.tracks ?? [],
    error: mine?.error,
    retry: () => {
      if (mine?.status !== 'error') return
      setFound(undefined)
      setAttempt((count) => count + 1)
    }
  }
}
