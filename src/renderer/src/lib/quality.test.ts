import { describe, expect, it } from 'vitest'
import { codecName, formatQuality } from './quality'

describe('codecName', () => {
  it.each([
    ['flac', 'FLAC'],
    ['ogg-vorbis', 'Ogg Vorbis'],
    ['opus', 'Opus'],
    ['alac', 'ALAC'],
    ['something-new', 'SOMETHING-NEW']
  ])('names %s as %s', (codec, name) => {
    expect(codecName(codec)).toBe(name)
  })
})

describe('formatQuality', () => {
  it.each([
    [{ codec: 'flac', lossless: true, bitDepth: 24, sampleRateHz: 96000 }, 'FLAC · 24-bit / 96 kHz'],
    [{ codec: 'flac', lossless: true, bitDepth: 16, sampleRateHz: 44100 }, 'FLAC · 16-bit / 44.1 kHz'],
    [{ codec: 'wav', lossless: true, sampleRateHz: 48000 }, 'WAV · 48 kHz'],
    [{ codec: 'alac', lossless: true }, 'ALAC'],
    [{ codec: 'aac', lossless: false, bitrateKbps: 256, sampleRateHz: 44100 }, 'AAC · 256 kbps'],
    [{ codec: 'ogg-vorbis', lossless: false, bitrateKbps: 320 }, 'Ogg Vorbis · 320 kbps'],
    [{ codec: 'mp3', lossless: false }, 'MP3']
  ])('formats %j', (quality, expected) => {
    expect(formatQuality(quality)).toBe(expected)
  })

  it('returns undefined when the format is unknown', () => {
    expect(formatQuality(undefined)).toBeUndefined()
  })
})
