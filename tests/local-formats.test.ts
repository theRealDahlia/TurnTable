import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileMetadata } from '../src/main/providers/local/metadata'
import { makeWav } from './helpers/wav'

const run = promisify(execFile)

/** Real encoders are only available through macOS's afconvert, so these checks run there. */
describe.skipIf(process.platform !== 'darwin')('reading real encoded files', () => {
  let dir: string
  const source = () => join(dir, 'source.wav')

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'turntable-formats-'))
    await writeFile(source(), makeWav({ seconds: 2, sampleRate: 96000, bitDepth: 24 }))
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  async function convert(name: string, args: string[]) {
    const out = join(dir, name)
    await run('afconvert', [source(), out, ...args])
    return readFileMetadata(out)
  }

  it('identifies 24-bit / 96 kHz FLAC as lossless with its exact format', async () => {
    const meta = await convert('hires.flac', ['-f', 'flac', '-d', 'flac@96000'])
    expect(meta.quality).toMatchObject({ codec: 'flac', lossless: true, sampleRateHz: 96000, bitDepth: 24 })
    expect(meta.durationMs).toBeGreaterThan(1990)
    expect(meta.durationMs).toBeLessThan(2010)
    expect(meta.title).toBe('hires')
  })

  it('identifies AAC in an m4a as lossy', async () => {
    const meta = await convert('song.m4a', ['-f', 'm4af', '-d', 'aac', '-b', '256000'])
    expect(meta.quality).toMatchObject({ codec: 'aac', lossless: false })
    expect(meta.quality.bitDepth).toBeUndefined()
  })

  it('identifies ALAC in an m4a as lossless', async () => {
    const meta = await convert('song-alac.m4a', ['-f', 'm4af', '-d', 'alac'])
    expect(meta.quality).toMatchObject({ codec: 'alac', lossless: true })
  })

  it('identifies 24-bit AIFF', async () => {
    const meta = await convert('song.aiff', ['-f', 'AIFF', '-d', 'BEI24@96000'])
    expect(meta.quality).toMatchObject({ codec: 'aiff', lossless: true, sampleRateHz: 96000, bitDepth: 24 })
  })
})
