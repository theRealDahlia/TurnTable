import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FolderStore } from '../src/main/providers/local/folderStore'
import { isAudioFile, scanAudioFiles } from '../src/main/providers/local/scan'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'turntable-local-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

const touch = async (...parts: string[]): Promise<string> => {
  const path = join(dir, ...parts)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, 'x')
  return path
}

describe('isAudioFile', () => {
  it.each(['a.flac', 'a.MP3', 'a.M4a', 'a.opus', 'a.wav', 'a.aiff', 'a.ogg'])('accepts %s', (name) => {
    expect(isAudioFile(name)).toBe(true)
  })
  it.each(['a.txt', 'a.jpg', 'a', 'flac', 'a.flac.part', '.flac'])('rejects %s', (name) => {
    expect(isAudioFile(name)).toBe(false)
  })
})

describe('scanAudioFiles', () => {
  it('finds audio files in nested folders, ignoring everything else, sorted naturally', async () => {
    const b = await touch('Album', '10 - b.flac')
    const a = await touch('Album', '2 - a.flac')
    const c = await touch('Other', 'Deep', 'c.mp3')
    await touch('Album', 'cover.jpg')
    await touch('notes.txt')

    expect(await scanAudioFiles([dir])).toEqual([a, b, c])
  })

  it('skips hidden files and folders', async () => {
    const visible = await touch('ok.flac')
    await touch('.hidden.flac')
    await touch('.Trashes', 'gone.flac')
    expect(await scanAudioFiles([dir])).toEqual([visible])
  })

  it('does not follow symlinked folders, so loops cannot hang the scan', async () => {
    const real = await touch('music', 'a.flac')
    await symlink(dir, join(dir, 'music', 'loop'))
    expect(await scanAudioFiles([dir])).toEqual([real])
  })

  it('lists a file once when folders overlap', async () => {
    const file = await touch('a', 'b', 'x.flac')
    expect(await scanAudioFiles([dir, join(dir, 'a')])).toEqual([file])
  })

  it('ignores folders that do not exist or cannot be read', async () => {
    const file = await touch('ok.flac')
    expect(await scanAudioFiles([join(dir, 'missing'), dir])).toEqual([file])
    expect(await scanAudioFiles([])).toEqual([])
  })
})

describe('FolderStore', () => {
  it('starts empty and remembers added folders', async () => {
    const store = new FolderStore(join(dir, 'state', 'folders.json'))
    expect(await store.list()).toEqual([])

    await store.add(['/music/a', '/music/b'])
    expect(await new FolderStore(join(dir, 'state', 'folders.json')).list()).toEqual(['/music/a', '/music/b'])
  })

  it('ignores duplicates and folders inside one that is already added', async () => {
    const store = new FolderStore(join(dir, 'f.json'))
    await store.add(['/music'])
    expect(await store.add(['/music', '/music/rock', '/music/'])).toEqual(['/music'])
  })

  it('replaces folders that a newly added parent covers, without confusing look-alike names', async () => {
    const store = new FolderStore(join(dir, 'f.json'))
    await store.add(['/music/rock', '/music/rock-live'])
    expect(await store.add(['/music'])).toEqual(['/music'])

    await store.clear()
    await store.add(['/music/rock'])
    expect(await store.add(['/music/rock-live'])).toEqual(['/music/rock', '/music/rock-live'])
  })

  it('clears everything', async () => {
    const store = new FolderStore(join(dir, 'f.json'))
    await store.add(['/music'])
    await store.clear()
    expect(await store.list()).toEqual([])
  })

  it('treats a corrupt or wrongly shaped file as empty instead of crashing', async () => {
    const path = join(dir, 'f.json')
    await writeFile(path, '{not json')
    expect(await new FolderStore(path).list()).toEqual([])
    await writeFile(path, JSON.stringify({ a: 1 }))
    expect(await new FolderStore(path).list()).toEqual([])
    await writeFile(path, JSON.stringify(['/ok', 5, null]))
    expect(await new FolderStore(path).list()).toEqual(['/ok'])
  })
})
