import type { Album, Track } from '@shared/types'
import { fold, hasArtist } from '../library/query'

/** The id of a local album: local files have no album ids, so it is made from the artist and the album title (ignoring case and accents). */
export const localAlbumId = (artist: string, title: string): string => `${fold(artist.trim())}\u0000${fold(title.trim())}`

/** Disc, then track number, then title; tracks without numbers go after those that have them. */
export function albumOrder(a: Track, b: Track): number {
  const byNumber = (x: number | undefined, y: number | undefined): number => (x === y ? 0 : x === undefined ? 1 : y === undefined ? -1 : x - y)
  return byNumber(a.discNumber, b.discNumber) || byNumber(a.trackNumber, b.trackNumber) || a.title.localeCompare(b.title, undefined, { numeric: true })
}

/**
 * The albums an artist has among the local files, built from the files' own tags: every album title on a file
 * credited to them, with the first cover found. Ordered by title.
 */
export function localAlbums(tracks: Track[], artist: string): Album[] {
  const byId = new Map<string, Album & { tracks: number }>()
  for (const track of tracks) {
    if (track.providerId !== 'local' || !track.album || !hasArtist(track, artist)) continue
    const id = localAlbumId(artist, track.album)
    const known = byId.get(id)
    if (known) {
      known.tracks++
      known.artworkUrl ??= track.artworkUrl
    } else {
      byId.set(id, { id, providerId: 'local', title: track.album, artists: [artist], artworkUrl: track.artworkUrl, tracks: 1 })
    }
  }
  return [...byId.values()]
    .map(({ tracks: count, ...album }) => ({ ...album, trackCount: count }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }))
}

/** The local files on one of `localAlbums`'s albums, in album order. */
export function localAlbumTracks(tracks: Track[], album: Album): Track[] {
  const artist = album.artists[0] ?? ''
  return tracks.filter((track) => track.providerId === 'local' && track.album !== undefined && hasArtist(track, artist) && localAlbumId(artist, track.album) === album.id).sort(albumOrder)
}
