import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize, sep } from 'node:path'
import { YOUTUBE_PLAYER_PAGE } from '@shared/youtubePlayer'

/** The player pages this server will serve. */
const PAGES: readonly string[] = [YOUTUBE_PLAYER_PAGE]

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'
}

export interface PlayerServer {
  /** Where one of the player pages is served, e.g. `http://127.0.0.1:50321/youtube-player.html`. */
  urlOf(page: string): string
  close(): void
}

/**
 * YouTube only plays embedded videos for a page with a real web origin, which a `file://` page doesn't have,
 * so the packaged app serves the player page over loopback. It serves that page and their scripts and nothing else, to this
 * machine only.
 */
export async function startPlayerServer(root: string): Promise<PlayerServer> {
  let origin = ''

  const server: Server = createServer((request, response) => {
    const deny = (status: number): void => void response.writeHead(status, { 'Content-Type': 'text/plain' }).end()

    // A web page in the user's browser must not be able to read this server through a rebinding trick.
    if (request.headers.host !== new URL(origin).host) return deny(421)
    if (request.method !== 'GET') return deny(405)

    let path: string
    try {
      path = decodeURIComponent(new URL(request.url ?? '/', origin).pathname)
    } catch {
      return deny(400)
    }
    const isPage = PAGES.some((page) => path === `/${page}`)
    const isScript = /^\/assets\/[\w.-]+\.(?:js|css)$/.test(path)
    if (!isPage && !isScript) return deny(404)

    const file = normalize(join(root, path))
    if (!file.startsWith(root + sep)) return deny(404)

    stat(file).then(
      (info) => {
        if (!info.isFile()) return deny(404)
        response.writeHead(200, {
          'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
          'Content-Length': info.size,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store'
        })
        createReadStream(file).on('error', () => response.destroy()).pipe(response)
      },
      () => deny(404)
    )
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  return {
    urlOf(page) {
      if (!PAGES.includes(page)) throw new Error(`Not a player page: ${page}`)
      return `${origin}/${page}`
    },
    close: () => void server.close()
  }
}
