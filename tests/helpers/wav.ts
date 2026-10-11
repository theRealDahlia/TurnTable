/** A valid PCM WAV file containing a sine tone, so tests can use real audio without committed binaries. */
export function makeWav({ seconds = 1, sampleRate = 44100, bitDepth = 16, channels = 2, frequency = 440 } = {}): Buffer {
  const bytesPerSample = bitDepth / 8
  const frames = Math.round(seconds * sampleRate)
  const dataSize = frames * channels * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28)
  buffer.writeUInt16LE(channels * bytesPerSample, 32)
  buffer.writeUInt16LE(bitDepth, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  const amplitude = 2 ** (bitDepth - 1) * 0.3
  for (let frame = 0; frame < frames; frame++) {
    const sample = Math.round(Math.sin((2 * Math.PI * frequency * frame) / sampleRate) * amplitude)
    for (let channel = 0; channel < channels; channel++) {
      const offset = 44 + (frame * channels + channel) * bytesPerSample
      if (bitDepth === 16) buffer.writeInt16LE(sample, offset)
      else buffer.writeIntLE(sample, offset, bytesPerSample)
    }
  }
  return buffer
}
