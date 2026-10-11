import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { describeFormat, readFileMetadata } from '../src/main/providers/local/metadata'
import { makeWav } from './helpers/wav'

describe('describeFormat', () => {
  it.each([
    [{ container: 'FLAC', codec: 'FLAC', sampleRate: 96000, bitsPerSample: 24 }, { codec: 'flac', lossless: true, sampleRateHz: 96000, bitDepth: 24 }],
    [{ container: 'MPEG', codec: 'MPEG 1 Layer 3', sampleRate: 44100, bitrate: 320000 }, { codec: 'mp3', lossless: false, bitrateKbps: 320 }],
    [{ container: 'M4A/mp42/isom', codec: 'MPEG-4/AAC', sampleRate: 44100, bitrate: 256000 }, { codec: 'aac', lossless: false, bitrateKbps: 256 }],
    [{ container: 'M4A/M4A /mp42/isom', codec: 'ALAC', sampleRate: 44100, bitsPerSample: 16, lossless: true }, { codec: 'alac', lossless: true, bitDepth: 16 }],
    [{ container: 'Ogg', codec: 'Vorbis I', sampleRate: 44100, bitrate: 160000 }, { codec: 'ogg-vorbis', lossless: false, bitrateKbps: 160 }],
    [{ container: 'Ogg', codec: 'Opus', sampleRate: 48000 }, { codec: 'opus', lossless: false }],
    [{ container: 'WAVE', codec: 'PCM', sampleRate: 44100, bitsPerSample: 16 }, { codec: 'wav', lossless: true, bitDepth: 16 }],
    [{ container: 'AIFF', codec: 'PCM', sampleRate: 44100, bitsPerSample: 24 }, { codec: 'aiff', lossless: true, bitDepth: 24 }],
    [{ container: 'Matroska', codec: 'weird' }, { codec: 'weird', lossless: false }],
    [{}, { codec: 'unknown', lossless: false }]
  ])('describes %j', (format, expected) => {
    expect(describeFormat(format)).toMatchObject(expected)
  })

  it('only reports a bit depth for lossless audio, where it means something', () => {
    expect(describeFormat({ container: 'MPEG', codec: 'MPEG 1 Layer 3', bitsPerSample: 16 }).bitDepth).toBeUndefined()
  })
})

describe('readFileMetadata', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'turntable-meta-'))
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('reads format and duration from a real file, falling back to the file name for the title', async () => {
    const path = join(dir, '01 My Song.wav')
    await writeFile(path, makeWav({ seconds: 2, sampleRate: 48000, bitDepth: 24 }))

    const meta = await readFileMetadata(path)

    expect(meta).toMatchObject({
      title: '01 My Song',
      artists: [],
      album: undefined,
      hasArtwork: false,
      quality: { codec: 'wav', lossless: true, sampleRateHz: 48000, bitDepth: 24 }
    })
    expect(meta.durationMs).toBeGreaterThan(1990)
    expect(meta.durationMs).toBeLessThan(2010)
  })

  it('rejects a file that is not audio', async () => {
    const path = join(dir, 'fake.flac')
    await writeFile(path, 'this is not audio')
    await expect(readFileMetadata(path)).rejects.toThrow()
  })
})
