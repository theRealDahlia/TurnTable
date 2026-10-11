import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'
import { MEDIA_SCHEME } from '@shared/media'
import { parseByteRange } from './range'

export interface Artwork {
  data: Uint8Array
  mime: string
}

export interface MediaDeps {
  /** Maps a track id to its file; undefined for ids the library never issued. */
  resolve(id: string): string | undefined
  readArtwork(path: string): Promise<Artwork | undefined>
}

const CONTENT_TYPES: Record<string, string> = {
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff'
}

/** Ids are the 24 hex characters the library issues, which also rules out path tricks like `..`. */
const ID_PATTERN = /^[0-9a-f]{24}$/

const notFound = (): Response => new Response(null, { status: 404 })

/**
 * Serves `turntable-media://audio/<id>` (with Range support, so seeking works) and
 * `turntable-media://art/<id>` for tracks the library knows. The renderer never sees file paths.
 */
export function createMediaHandler(deps: MediaDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })

    const url = new URL(request.url)
    if (url.protocol !== `${MEDIA_SCHEME}:`) return notFound()
    const id = url.pathname.slice(1)
    const path = ID_PATTERN.test(id) ? deps.resolve(id) : undefined
    if (!path) return notFound()

    if (url.hostname === 'art') return serveArtwork(deps, path)
    if (url.hostname === 'audio') return serveAudio(request, path)
    return notFound()
  }
}

async function serveArtwork(deps: MediaDeps, path: string): Promise<Response> {
  try {
    const artwork = await deps.readArtwork(path)
    if (!artwork) return notFound()
    return new Response(Buffer.from(artwork.data), {
      headers: { 'Content-Type': artwork.mime, 'Content-Length': String(artwork.data.byteLength), 'Cache-Control': 'max-age=3600' }
    })
  } catch {
    return notFound()
  }
}

async function serveAudio(request: Request, path: string): Promise<Response> {
  let size: number
  try {
    size = (await stat(path)).size
  } catch {
    return notFound()
  }

  const headers: Record<string, string> = {
    'Content-Type': CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes'
  }

  const range = parseByteRange(request.headers.get('Range'), size)
  if (range === 'unsatisfiable') return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })

  const { start, end } = range ?? { start: 0, end: size - 1 }
  const status = range ? 206 : 200
  headers['Content-Length'] = String(size === 0 ? 0 : end - start + 1)
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`

  if (request.method === 'HEAD' || size === 0) return new Response(null, { status, headers })
  const body = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream
  return new Response(body, { status, headers })
}
