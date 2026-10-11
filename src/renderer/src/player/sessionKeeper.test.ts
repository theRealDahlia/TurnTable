// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSilentKeeper, silentWav } from './sessionKeeper'

describe('silentWav', () => {
  const read = (bytes: Uint8Array) => {
    const view = new DataView(bytes.buffer)
    const text = (at: number, length: number): string => String.fromCharCode(...bytes.slice(at, at + length))
    return {
      riff: text(0, 4),
      wave: text(8, 4),
      fmt: text(12, 4),
      data: text(36, 4),
      fileSize: view.getUint32(4, true),
      format: view.getUint16(20, true),
      channels: view.getUint16(22, true),
      rate: view.getUint32(24, true),
      bits: view.getUint16(34, true),
      dataSize: view.getUint32(40, true)
    }
  }

  it('is a well-formed mono 8-bit PCM file', () => {
    const bytes = silentWav(10, 8000)
    expect(read(bytes)).toEqual({ riff: 'RIFF', wave: 'WAVE', fmt: 'fmt ', data: 'data', fileSize: bytes.length - 8, format: 1, channels: 1, rate: 8000, bits: 8, dataSize: 80_000 })
    expect(bytes.length).toBe(44 + 80_000)
  })

  it('is silent: every sample sits on the 8-bit centre line', () => {
    const samples = silentWav(1, 8000).slice(44)
    expect(samples).toHaveLength(8000)
    expect(new Set(samples)).toEqual(new Set([128]))
  })

  it('lasts long enough for the browser\'s media controls to take notice', () => {
    expect(read(silentWav()).dataSize / read(silentWav()).rate).toBeGreaterThanOrEqual(5)
  })
})

describe('createSilentKeeper', () => {
  const play = vi.fn()
  const pause = vi.fn()
  const made: { src: string; loop: boolean; volume: number }[] = []

  beforeEach(() => {
    play.mockReset().mockResolvedValue(undefined)
    pause.mockReset()
    made.length = 0
    vi.stubGlobal(
      'Audio',
      class {
        loop = false
        volume = 0
        constructor(public src: string) {
          made.push(this)
        }
        play = play
        pause = pause
      }
    )
    URL.createObjectURL = vi.fn(() => 'blob:silence')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(URL, 'createObjectURL')
  })

  it('makes nothing until it is needed', () => {
    createSilentKeeper()
    expect(made).toHaveLength(0)
  })

  it('plays a looping silence at full volume, from a file made on the spot', () => {
    createSilentKeeper().start()
    expect(made).toHaveLength(1)
    expect(made[0]).toMatchObject({ src: 'blob:silence', loop: true, volume: 1 })
    expect(play).toHaveBeenCalledOnce()
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob
    expect(blob.type).toBe('audio/wav')
    expect(blob.size).toBe(44 + 80_000)
  })

  it('reuses the one element for every start and stop', () => {
    const keeper = createSilentKeeper()
    keeper.start()
    keeper.stop()
    keeper.start()
    expect(made).toHaveLength(1)
    expect(play).toHaveBeenCalledTimes(2)
    expect(pause).toHaveBeenCalledOnce()
  })

  it('has nothing to stop before it has started', () => {
    createSilentKeeper().stop()
    expect(pause).not.toHaveBeenCalled()
  })

  it('shrugs off a refusal to play', async () => {
    play.mockRejectedValue(new Error('blocked'))
    expect(() => createSilentKeeper().start()).not.toThrow()
    await Promise.resolve()
  })

  it('does nothing where audio files cannot be made', () => {
    ;(URL as { createObjectURL?: unknown }).createObjectURL = undefined
    const keeper = createSilentKeeper()
    expect(() => {
      keeper.start()
      keeper.stop()
    }).not.toThrow()
    expect(made).toHaveLength(0)
  })
})
