import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FolderStore } from '../src/main/providers/local/folderStore'
import { LocalLibrary, trackIdForPath } from '../src/main/providers/local/library'
import type { FileMetadata } from '../src/main/providers/local/metadata'
import { createLocalProvider } from '../src/main/providers/local/provider'

let dir: string
let folders: FolderStore
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'turntable-lib-'))
  folders = new FolderStore(join(dir, 'folders.json'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const meta = (title: string, overrides: Partial<FileMetadata> = {}): FileMetadata => ({
  title,
  artists: ['Artist'],
  album: 'Album',
  durationMs: 1000,
  quality: { codec: 'flac', lossless: true, sampleRateHz: 44100, bitDepth: 16 },
  hasArtwork: false,
  ...overrides
})

/** Creates `count` real files (so stat works) and a library that reads metadata from a fake. */
async function setup(count: number, readMetadata = vi.fn(async (path: string) => meta(`T:${path.split('/').pop()}`))) {
  const paths: string[] = []
  for (let i = 0; i < count; i++) {
    const path = join(dir, `${String(i).padStart(3, '0')}.flac`)
    await writeFile(path, 'x')
    paths.push(path)
  }
  await folders.add([dir])
  const library = new LocalLibrary({ folders, readMetadata })
  const pickFolders = vi.fn(async () => [dir])
  return { paths, readMetadata, library, pickFolders, provider: createLocalProvider({ folders, library, pickFolders }) }
}

describe('local provider', () => {
  it('is connected only once folders have been added', async () => {
    const { provider } = await setup(0)
    await folders.clear()
    expect(await provider.isConnected()).toBe(false)

    await provider.connect()
    expect(await provider.isConnected()).toBe(true)
  })

  it('adds the chosen folders on connect, and does nothing when the picker is cancelled', async () => {
    const { provider, pickFolders } = await setup(0)
    await folders.clear()
    pickFolders.mockResolvedValueOnce([])

    await provider.connect()
    expect(await folders.list()).toEqual([])

    await provider.connect()
    expect(await folders.list()).toEqual([dir])
  })

  it('forgets the folders and the scanned files on disconnect', async () => {
    const { provider, library } = await setup(2)
    await provider.getSavedTracks()
    await provider.disconnect()

    expect(await provider.isConnected()).toBe(false)
    expect(library.isScanned).toBe(false)
    expect((await provider.getSavedTracks()).tracks).toEqual([])
  })

  it('returns tracks with tags, format, artwork link and file date', async () => {
    const { provider, paths, readMetadata } = await setup(1)
    readMetadata.mockResolvedValue(meta('Song', { hasArtwork: true, artists: ['A', 'B'] }))

    const { tracks, nextCursor } = await provider.getSavedTracks()

    expect(nextCursor).toBeUndefined()
    expect(tracks).toHaveLength(1)
    const id = trackIdForPath(paths[0]!)
    expect(tracks[0]).toMatchObject({
      id,
      providerId: 'local',
      title: 'Song',
      artists: ['A', 'B'],
      album: 'Album',
      durationMs: 1000,
      artworkUrl: `turntable-media://art/${id}`,
      quality: { codec: 'flac', lossless: true, sampleRateHz: 44100, bitDepth: 16 }
    })
    expect(new Date(tracks[0]!.savedAt!).getTime()).not.toBeNaN()
  })

  it('never exposes file paths to the renderer', async () => {
    const { provider } = await setup(1)
    expect(JSON.stringify(await provider.getSavedTracks())).not.toContain(dir)
  })

  it('pages through 120 files, 50 at a time, without reading tags for pages nobody asked for', async () => {
    const { provider, readMetadata } = await setup(120)

    const first = await provider.getSavedTracks()
    expect(first.tracks).toHaveLength(50)
    expect(first.nextCursor).toBe('50')
    expect(readMetadata).toHaveBeenCalledTimes(50)

    const second = await provider.getSavedTracks(first.nextCursor)
    const third = await provider.getSavedTracks(second.nextCursor)
    expect(third.tracks).toHaveLength(20)
    expect(third.nextCursor).toBeUndefined()
    expect(new Set([...first.tracks, ...second.tracks, ...third.tracks].map((t) => t.id)).size).toBe(120)
  })

  it('skips unreadable files but still advances past them', async () => {
    const { provider, readMetadata } = await setup(3)
    readMetadata.mockImplementation(async (path: string) => {
      if (path.endsWith('001.flac')) throw new Error('corrupt')
      return meta('ok')
    })

    const page = await provider.getSavedTracks()
    expect(page.tracks).toHaveLength(2)
    expect(page.nextCursor).toBeUndefined()
  })

  it('re-reads tags only for files that changed since the last load', async () => {
    const { provider, readMetadata, paths } = await setup(3)
    await provider.getSavedTracks()
    expect(readMetadata).toHaveBeenCalledTimes(3)

    await provider.getSavedTracks()
    expect(readMetadata).toHaveBeenCalledTimes(3)

    const later = new Date(Date.now() + 60_000)
    await (await import('node:fs/promises')).utimes(paths[1]!, later, later)
    await provider.getSavedTracks()
    expect(readMetadata).toHaveBeenCalledTimes(4)
  })

  it('picks up files added after the last scan when the library is reloaded', async () => {
    const { provider } = await setup(2)
    expect((await provider.getSavedTracks()).tracks).toHaveLength(2)

    await writeFile(join(dir, '999.flac'), 'x')
    expect((await provider.getSavedTracks()).tracks).toHaveLength(3)
  })

  it('resolves only ids it issued, so the renderer cannot ask for arbitrary files', async () => {
    const { provider, library, paths } = await setup(2)
    const { tracks } = await provider.getSavedTracks()
    const id = tracks[0]!.id

    expect(library.resolve(id)).toBe(paths[0])
    expect(library.resolve('../../etc/passwd')).toBeUndefined()
    expect(library.resolve(trackIdForPath('/etc/passwd'))).toBeUndefined()
  })

  it.each(['-1', 'abc', '1e3', '5;6'])('rejects the invalid cursor %j', async (cursor) => {
    const { provider } = await setup(1)
    await expect(provider.getSavedTracks(cursor)).rejects.toThrow('Invalid library cursor')
  })

  it('scans on demand when asked for a later page before any scan (e.g. after a restart)', async () => {
    const { provider } = await setup(60)
    expect((await provider.getSavedTracks('50')).tracks).toHaveLength(10)
  })
})
