import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startPlayerServer, type PlayerServer } from '../src/main/embedPlayer/server'

let root: string
let server: PlayerServer | undefined

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'turntable-yt-'))
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'youtube-player.html'), '<p>player</p>')
  await writeFile(join(root, 'soundcloud-player.html'), '<p>soundcloud</p>')
  await writeFile(join(root, 'index.html'), '<p>app</p>')
  await writeFile(join(root, 'assets', 'player-abc123.js'), 'console.log(1)')
  await writeFile(join(root, 'assets', 'style.css'), 'p{}')
  await writeFile(join(root, 'assets', 'secret.txt'), 'nope')
  await writeFile(join(root, '..secret.js'), 'nope')
})
afterEach(async () => {
  server?.close()
  server = undefined
  await rm(root, { recursive: true, force: true })
})

/** A raw request, so tests can send a Host header or a path that `fetch` would refuse or tidy up. */
function get(url: string, options: { path?: string; host?: string; method?: string } = {}): Promise<{ status: number; type?: string; body: string; headers: Record<string, unknown> }> {
  const target = new URL(url)
  return new Promise((resolve, reject) => {
    const req = request(
      { host: target.hostname, port: target.port, path: options.path ?? target.pathname, method: options.method ?? 'GET', headers: options.host ? { Host: options.host } : {} },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => (body += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, type: res.headers['content-type'], body, headers: res.headers }))
      }
    )
    req.on('error', reject)
    req.end()
  })
}

/** The address of the YouTube page, which is what most of these tests visit. */
const youtube = (running: PlayerServer): string => running.urlOf('youtube-player.html')

describe('player server', () => {
  it('listens on loopback only and serves the player page', async () => {
    server = await startPlayerServer(root)
    expect(youtube(server)).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/youtube-player\.html$/)

    const page = await get(youtube(server))
    expect(page.status).toBe(200)
    expect(page.type).toBe('text/html; charset=utf-8')
    expect(page.body).toBe('<p>player</p>')
    expect(page.headers['x-content-type-options']).toBe('nosniff')
  })

  it('serves the page\'s scripts and styles with the right types', async () => {
    server = await startPlayerServer(root)
    const base = new URL(youtube(server)).origin
    const script = await get(`${base}/assets/player-abc123.js`)
    expect([script.status, script.type, script.body]).toEqual([200, 'text/javascript; charset=utf-8', 'console.log(1)'])
    const style = await get(`${base}/assets/style.css`)
    expect([style.status, style.type]).toEqual([200, 'text/css; charset=utf-8'])
  })

  it.each(['/index.html', '/', '/assets/secret.txt', '/assets/missing.js', '/assets/', '/assets/sub/x.js', '/youtube-player.html/extra'])('does not serve %s', async (path) => {
    server = await startPlayerServer(root)
    expect((await get(youtube(server), { path })).status).toBe(404)
  })

  it.each(['/assets/../index.html', '/assets/%2e%2e/index.html', '/assets/..%2findex.html', '/assets/%2e%2e%2f%2e%2e%2fsecret.js', '/../index.html', '/assets/..\\index.html'])('refuses to climb out of the folder with %s', async (path) => {
    server = await startPlayerServer(root)
    const { status, body } = await get(youtube(server), { path })
    expect(status).not.toBe(200)
    expect(body).not.toContain('app')
    expect(body).not.toContain('nope')
  })

  it('refuses a malformed escape sequence', async () => {
    server = await startPlayerServer(root)
    expect((await get(youtube(server), { path: '/assets/%zz.js' })).status).toBe(400)
  })

  it('refuses requests addressed to any other host name (DNS rebinding)', async () => {
    server = await startPlayerServer(root)
    expect((await get(youtube(server), { host: 'evil.example.com' })).status).toBe(421)
    expect((await get(youtube(server), { host: 'localhost' })).status).toBe(421)
  })

  it('only answers GET', async () => {
    server = await startPlayerServer(root)
    expect((await get(youtube(server), { method: 'POST' })).status).toBe(405)
  })

  it('serves SoundCloud\'s page from the same place', async () => {
    server = await startPlayerServer(root)
    const url = server.urlOf('soundcloud-player.html')
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/soundcloud-player\.html$/)
    expect(new URL(url).origin).toBe(new URL(youtube(server)).origin)
    const page = await get(url)
    expect([page.status, page.type, page.body]).toEqual([200, 'text/html; charset=utf-8', '<p>soundcloud</p>'])
  })

  it.each(['index.html', 'other.html', '../index.html', 'youtube-player.html/../index.html', ''])('refuses to name %j as a player page', async (page) => {
    server = await startPlayerServer(root)
    expect(() => server!.urlOf(page)).toThrow('Not a player page')
  })

  it('stops listening when closed', async () => {
    const started = await startPlayerServer(root)
    started.close()
    await expect(get(youtube(started))).rejects.toThrow()
  })

  it('gives each start its own free port', async () => {
    server = await startPlayerServer(root)
    const other = await startPlayerServer(root)
    expect(new URL(youtube(other)).port).not.toBe(new URL(youtube(server)).port)
    other.close()
  })
})
