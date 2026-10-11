import type { AudioQuality } from '@shared/types'

const CODEC_NAMES: Record<string, string> = {
  flac: 'FLAC',
  alac: 'ALAC',
  mp3: 'MP3',
  aac: 'AAC',
  opus: 'Opus',
  'ogg-vorbis': 'Ogg Vorbis',
  wav: 'WAV',
  aiff: 'AIFF'
}

export const codecName = (codec: string): string => CODEC_NAMES[codec] ?? codec.toUpperCase()

/** 44100 -> "44.1", 96000 -> "96". */
const kilohertz = (hz: number): string => String(Number((hz / 1000).toFixed(1)))

/** "FLAC · 24-bit / 96 kHz" for lossless audio, "AAC · 256 kbps" for lossy; undefined when nothing is known. */
export function formatQuality(quality: AudioQuality | undefined): string | undefined {
  if (!quality) return undefined
  const detail = quality.lossless
    ? quality.bitDepth && quality.sampleRateHz
      ? `${quality.bitDepth}-bit / ${kilohertz(quality.sampleRateHz)} kHz`
      : quality.sampleRateHz
        ? `${kilohertz(quality.sampleRateHz)} kHz`
        : undefined
    : quality.bitrateKbps
      ? `${quality.bitrateKbps} kbps`
      : undefined
  return [codecName(quality.codec), detail].filter(Boolean).join(' · ')
}
