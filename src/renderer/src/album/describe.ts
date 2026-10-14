import type { Album } from '@shared/types'
import { formatDuration } from '../library/query'

const KIND_NAMES: Record<NonNullable<Album['kind']>, string> = { album: 'Album', single: 'Single', ep: 'EP', compilation: 'Compilation' }

/** "Album", "Single", "EP" or "Compilation"; just "Album" when the service doesn't say. */
export const kindName = (album: Album): string => KIND_NAMES[album.kind ?? 'album']

/** The year an album came out, when the service says. */
export const releaseYear = (album: Album): string | undefined => album.releaseDate?.match(/^\d{4}/)?.[0]

/** "12 songs, 47 min" for the tracks of an album. */
export function describeLength(count: number, totalMs: number): string {
  const songs = `${count} ${count === 1 ? 'song' : 'songs'}`
  if (totalMs <= 0) return songs
  const minutes = Math.round(totalMs / 60_000)
  return `${songs}, ${minutes >= 60 ? formatDuration(totalMs) : `${Math.max(1, minutes)} min`}`
}
