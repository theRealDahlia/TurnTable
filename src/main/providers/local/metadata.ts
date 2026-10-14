import { basename, extname } from 'node:path'
import { parseFile, selectCover, type IFormat } from 'music-metadata'
import type { AudioQuality } from '@shared/types'

export interface FileMetadata {
  title: string
  artists: string[]
  album?: string
  /** From the tags, when they say: which disc of the album, and which track on it. */
  discNumber?: number
  trackNumber?: number
  durationMs: number
  quality: AudioQuality
  hasArtwork: boolean
}

/** Maps music-metadata's free-form container/codec strings onto the short names the app uses. */
export function describeFormat(format: Pick<IFormat, 'container' | 'codec' | 'lossless' | 'sampleRate' | 'bitsPerSample' | 'bitrate'>): AudioQuality {
  const container = (format.container ?? '').toLowerCase()
  const codec = (format.codec ?? '').toLowerCase()

  let name: string
  let lossless = format.lossless ?? false
  if (container.includes('flac') || codec.includes('flac')) [name, lossless] = ['flac', true]
  else if (codec.includes('alac')) [name, lossless] = ['alac', true]
  else if (codec.includes('opus')) name = 'opus'
  else if (codec.includes('vorbis')) name = 'ogg-vorbis'
  else if (codec.includes('layer 3') || codec.includes('mp3')) name = 'mp3'
  else if (codec.includes('aac')) name = 'aac'
  else if (container.includes('wav')) [name, lossless] = ['wav', true]
  else if (container.includes('aiff')) [name, lossless] = ['aiff', true]
  else name = codec || container || 'unknown'

  return {
    codec: name,
    lossless,
    sampleRateHz: format.sampleRate,
    bitDepth: lossless ? format.bitsPerSample : undefined,
    bitrateKbps: format.bitrate ? Math.round(format.bitrate / 1000) : undefined
  }
}

export type ReadMetadata = (path: string) => Promise<FileMetadata>

/** A tag's number, if it is a sensible positive one. */
const tagNumber = (value: number | null | undefined): number | undefined => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined)

/** Reads tags and audio format from one file, falling back to the file name when tags are missing. */
export const readFileMetadata: ReadMetadata = async (path) => {
  const { common, format } = await parseFile(path, { duration: true })
  const artists = common.artists?.length ? common.artists : common.artist ? [common.artist] : []
  return {
    title: common.title?.trim() || basename(path, extname(path)),
    artists,
    album: common.album?.trim() || undefined,
    discNumber: tagNumber(common.disk.no),
    trackNumber: tagNumber(common.track.no),
    durationMs: Math.round((format.duration ?? 0) * 1000),
    quality: describeFormat(format),
    hasArtwork: (common.picture?.length ?? 0) > 0
  }
}

/** The embedded cover image of one file, if it has one. */
export async function readArtwork(path: string): Promise<{ data: Uint8Array; mime: string } | undefined> {
  const { common } = await parseFile(path, { skipCovers: false })
  const cover = selectCover(common.picture)
  return cover ? { data: cover.data, mime: cover.format } : undefined
}
