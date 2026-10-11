import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMediaHandler, type Artwork } from '../src/main/media/handler'
import { parseByteRange } from '../src/main/media/range'

describe('parseByteRange', () => {
  it('returns undefined when there is no Range header', () => {
    expect(parseByteRange(null, 100)).toBeUndefined()
  })

  it.each([
    ['bytes=0-9', { start: 0, end: 9 }],
    ['bytes=10-', { start: 10, end: 99 }],
    ['bytes=90-500', { start: 90, end: 99 }],
    ['bytes=-10', { start: 90, end: 99 }],
    ['bytes=-500', { start: 0, end: 99 }],
    ['bytes=99-99', { start: 99, end: 99 }]
  ])('parses %s', (header, expected) => {
    expect(parseByteRange(header, 100)).toEqual(expected)
  })

  it.each(['bytes=100-', 'bytes=50-40', 'bytes=-0', 'bytes=-', 'bytes=0-1,5-6', 'items=0-5', 'bytes=a-b', '', 'bytes=0-9;evil'])(
    'rejects %j as unsatisfiable',
    (header) => {
      expect(parseByteRange(header, 100)).toBe('unsatisfiable')
    }
  )

  it('cannot satisfy any range on an empty file', () => {
    expect(parseByteRange('bytes=0-', 0)).toBe('unsatisfiable')
    expect(parseByteRange('bytes=-5', 0)).toBe('unsatisfiable')
  })
})

describe('media handler', () => {
  const ID = 'a'.repeat(24)
  const ART_ID = 'b'.repeat(24)
  const MISSING_FILE_ID = 'c'.repeat(24)
  const content = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251))
  let dir: string
  let readArtwork: ReturnType<typeof vi.fn<(path: string) => Promise<Artwork | undefined>>>
  let handle: (request: Request) => Promise<Response>

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'turntable-media-'))
    const files: Record<string, string> = {
      [ID]: join(dir, 'song.flac'),
      [ART_ID]: join(dir, 'art.mp3'),
      [MISSING_FILE_ID]: join(dir, 'gone.flac')
    }
    await writeFile(files[ID]!, content)
    await writeFile(files[ART_ID]!, 'x')
    readArtwork = vi.fn(async (path: string) =>
      path.endsWith('art.mp3') ? { data: new Uint8Array([1, 2, 3, 4]), mime: 'image/jpeg' } : undefined
    )
    handle = createMediaHandler({ resolve: (id) => files[id], readArtwork })
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  const get = (path: string, init?: RequestInit): Promise<Response> => handle(new Request(`turntable-media://${path}`, init))
  const bytes = async (response: Response): Promise<Buffer> => Buffer.from(await response.arrayBuffer())

  it('serves the whole file with its type and range support advertised', async () => {
    const response = await get(`audio/${ID}`)

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('audio/flac')
    expect(response.headers.get('Accept-Ranges')).toBe('bytes')
    expect(response.headers.get('Content-Length')).toBe('1000')
    expect((await bytes(response)).equals(content)).toBe(true)
  })

  it('serves exactly the requested bytes as 206 so seeking works', async () => {
    const response = await get(`audio/${ID}`, { headers: { Range: 'bytes=100-199' } })

    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe('bytes 100-199/1000')
    expect(response.headers.get('Content-Length')).toBe('100')
    expect((await bytes(response)).equals(content.subarray(100, 200))).toBe(true)
  })

  it('supports open-ended and suffix ranges', async () => {
    const tail = await get(`audio/${ID}`, { headers: { Range: 'bytes=990-' } })
    expect((await bytes(tail)).equals(content.subarray(990))).toBe(true)

    const suffix = await get(`audio/${ID}`, { headers: { Range: 'bytes=-5' } })
    expect(suffix.headers.get('Content-Range')).toBe('bytes 995-999/1000')
    expect((await bytes(suffix)).equals(content.subarray(995))).toBe(true)
  })

  it('answers an out-of-bounds range with 416 and the real size', async () => {
    const response = await get(`audio/${ID}`, { headers: { Range: 'bytes=5000-' } })
    expect(response.status).toBe(416)
    expect(response.headers.get('Content-Range')).toBe('bytes */1000')
  })

  it('answers HEAD with headers only', async () => {
    const response = await get(`audio/${ID}`, { method: 'HEAD' })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Length')).toBe('1000')
    expect((await bytes(response)).length).toBe(0)
  })

  it('refuses methods other than GET and HEAD', async () => {
    const response = await get(`audio/${ID}`, { method: 'POST', body: 'x' })
    expect(response.status).toBe(405)
  })

  it.each([
    ['an id the library never issued', `audio/${'d'.repeat(24)}`],
    ['a path traversal attempt', 'audio/..%2F..%2Fetc%2Fpasswd'],
    ['a raw path', 'audio/etc/passwd'],
    ['an id with the wrong length', `audio/${'a'.repeat(23)}`],
    ['an uppercase id', `audio/${'A'.repeat(24)}`],
    ['no id', 'audio/'],
    ['an unknown kind', `video/${ID}`],
    ['a file that has since been deleted', `audio/${MISSING_FILE_ID}`]
  ])('returns 404 for %s', async (_label, path) => {
    expect((await get(path)).status).toBe(404)
  })

  it('serves embedded artwork with its image type', async () => {
    const response = await get(`art/${ART_ID}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/jpeg')
    expect(Array.from(await bytes(response))).toEqual([1, 2, 3, 4])
  })

  it('returns 404 for artwork when the file has none, or cannot be read', async () => {
    expect((await get(`art/${ID}`)).status).toBe(404)
    readArtwork.mockRejectedValueOnce(new Error('corrupt'))
    expect((await get(`art/${ART_ID}`)).status).toBe(404)
  })

  it('serves an empty file without crashing', async () => {
    await writeFile(join(dir, 'empty.flac'), '')
    const emptyId = 'e'.repeat(24)
    const emptyHandle = createMediaHandler({ resolve: (id) => (id === emptyId ? join(dir, 'empty.flac') : undefined), readArtwork })

    const response = await emptyHandle(new Request(`turntable-media://audio/${emptyId}`))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Length')).toBe('0')
  })
})
