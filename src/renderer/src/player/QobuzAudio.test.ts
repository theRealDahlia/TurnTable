import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QobuzStream } from '@shared/qobuz'
import { errorMessageOf } from './media'
import { QobuzAudio, qobuzTrackIdFromSource } from './QobuzAudio'

/** Just enough of an <audio> element: it keeps what it is given, and says when it plays. */
class FakeElement extends EventTarget {
  src = ''
  currentTime = 0
  volume = 1
  duration = Number.NaN
  paused = true
  ended = false
  error: { code: number } | null = null
  playResult: () => Promise<void> = () => Promise.resolve()
  play = vi.fn(() => {
    this.paused = false
    return this.playResult()
  })
  pause = vi.fn(() => void (this.paused = true))
  removeAttribute = vi.fn(() => void (this.src = ''))
  load = vi.fn()
  emit(type: string): void {
    this.dispatchEvent(new Event(type))
  }
}

const stream = (url: string): QobuzStream => ({ url, quality: { codec: 'flac', lossless: true, bitDepth: 24, sampleRateHz: 96000 } })
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

let element: FakeElement
let getStream: ReturnType<typeof vi.fn>

function setup(source: string | undefined = 'qobuz:123') {
  element = new FakeElement()
  getStream = vi.fn(async (id: string) => stream(`https://streaming.example/${id}/a.flac`))
  const audio = new QobuzAudio(getStream as never, { createAudio: () => element as unknown as HTMLAudioElement })
  const heard: string[] = []
  const errors: (string | undefined)[] = []
  for (const type of ['playing', 'waiting', 'pause', 'timeupdate', 'durationchange', 'ended']) audio.addEventListener(type, () => heard.push(type))
  audio.addEventListener('error', (event) => errors.push(errorMessageOf(event)))
  if (source !== undefined) audio.src = source
  return { audio, heard, errors }
}

beforeEach(() => vi.clearAllMocks())

describe('qobuzTrackIdFromSource', () => {
  it.each([
    ['qobuz:123', '123'],
    ['qobuz:1', '1'],
    ['qobuz:', undefined],
    ['qobuz:abc', undefined],
    ['qobuz:12/../3', undefined],
    ['qobuz:1234567890123', undefined],
    ['spotify:track:123', undefined],
    ['turntable-media://audio/abc', undefined],
    ['', undefined]
  ])('reads %j as %j', (source, expected) => {
    expect(qobuzTrackIdFromSource(source)).toBe(expected)
  })
})

describe('QobuzAudio', () => {
  it('reports the source it was given, and nothing for an invalid one', () => {
    expect(setup().audio.src).toBe('qobuz:123')
    expect(setup('qobuz:nope').audio.src).toBe('')
  })

  it('refuses to play an invalid source, without asking Qobuz', async () => {
    const { audio } = setup('qobuz:nope')
    await expect(audio.play()).rejects.toThrow('not a valid Qobuz track')
    expect(getStream).not.toHaveBeenCalled()
  })

  it('asks Qobuz for the stream, gives its address to the element, and plays it', async () => {
    const { audio } = setup()

    await audio.play()

    expect(getStream).toHaveBeenCalledExactlyOnceWith('123')
    expect(element.src).toBe('https://streaming.example/123/a.flac')
    expect(element.play).toHaveBeenCalledOnce()
    expect(audio.paused).toBe(false)
  })

  it('asks only once for a track, however often it is paused and resumed', async () => {
    const { audio } = setup()
    await audio.play()
    audio.pause()
    await audio.play()
    await audio.play()
    expect(getStream).toHaveBeenCalledOnce()
    expect(element.play).toHaveBeenCalledTimes(3)
  })

  it('passes the element\'s events on', async () => {
    const { audio, heard } = setup()
    await audio.play()
    for (const type of ['playing', 'timeupdate', 'durationchange', 'waiting', 'pause', 'ended']) element.emit(type)
    expect(heard).toEqual(['playing', 'timeupdate', 'durationchange', 'waiting', 'pause', 'ended'])
  })

  it('reads time, length, and state from the element once it has the stream', async () => {
    const { audio } = setup()
    expect(audio.duration).toBeNaN()
    await audio.play()
    element.duration = 215
    element.currentTime = 12
    element.ended = false
    expect([audio.duration, audio.currentTime, audio.ended]).toEqual([215, 12, false])
  })

  it('keeps a position set before the stream is ready, and applies it as soon as it is', async () => {
    const { audio } = setup()
    audio.currentTime = 90
    expect(audio.currentTime).toBe(90)
    await audio.play()
    expect(element.currentTime).toBe(90)
  })

  it('seeks the element directly once it has the stream', async () => {
    const { audio } = setup()
    await audio.play()
    audio.currentTime = 33
    expect(element.currentTime).toBe(33)
  })

  it('applies the volume, including one chosen before the stream was ready', async () => {
    const { audio } = setup()
    audio.volume = 0.4
    expect(element.volume).toBe(0.4)
    expect(audio.volume).toBe(0.4)
    element.volume = 1
    await audio.play()
    expect(element.volume).toBe(0.4)
  })

  it('pauses the element', async () => {
    const { audio } = setup()
    await audio.play()
    audio.pause()
    expect(element.pause).toHaveBeenCalled()
    expect(audio.paused).toBe(true)
  })

  it("lets play() fail with Qobuz's own message when it won't give a stream, and tries again next time", async () => {
    const { audio } = setup()
    getStream.mockRejectedValueOnce(new Error("Qobuz only allows a preview of this track, so it can't be played here."))
    await expect(audio.play()).rejects.toThrow('only allows a preview')
    expect(element.play).not.toHaveBeenCalled()

    await audio.play()
    expect(getStream).toHaveBeenCalledTimes(2)
    expect(element.play).toHaveBeenCalledOnce()
  })

  it('drops an address that arrives after the track was changed', async () => {
    const { audio } = setup()
    let release!: (value: QobuzStream) => void
    getStream.mockImplementationOnce(() => new Promise<QobuzStream>((resolve) => (release = resolve)))
    const playing = audio.play()

    audio.src = 'qobuz:456'
    release(stream('https://streaming.example/123/late.flac'))
    await playing

    expect(element.src).not.toBe('https://streaming.example/123/late.flac')
    expect(element.play).not.toHaveBeenCalled()
    expect(audio.src).toBe('qobuz:456')
  })

  it('stops and empties the element when the source changes, and starts the next track afresh', async () => {
    const { audio } = setup()
    await audio.play()
    element.currentTime = 50

    audio.src = 'qobuz:456'

    expect(element.pause).toHaveBeenCalled()
    expect(element.removeAttribute).toHaveBeenCalledWith('src')
    await audio.play()
    expect(getStream).toHaveBeenLastCalledWith('456')
    expect(element.src).toBe('https://streaming.example/456/a.flac')
  })

  it('clears the source on removeAttribute', async () => {
    const { audio } = setup()
    await audio.play()
    audio.removeAttribute('src')
    expect(audio.src).toBe('')
    expect(element.removeAttribute).toHaveBeenCalledWith('src')
  })

  describe('an address that has lapsed', () => {
    it('gets a fresh one once, and carries on from the same place', async () => {
      const { audio, errors } = setup()
      await audio.play()
      element.currentTime = 71
      getStream.mockResolvedValueOnce(stream('https://streaming.example/123/fresh.flac'))

      element.error = { code: 4 }
      element.emit('error')
      await flush()

      expect(getStream).toHaveBeenCalledTimes(2)
      expect(element.src).toBe('https://streaming.example/123/fresh.flac')
      expect(element.currentTime).toBe(71)
      expect(element.play).toHaveBeenCalledTimes(2)
      expect(errors).toEqual([])
    })

    it('treats a network error the same way', async () => {
      const { audio, errors } = setup()
      await audio.play()
      element.error = { code: 2 }
      element.emit('error')
      await flush()
      expect(getStream).toHaveBeenCalledTimes(2)
      expect(errors).toEqual([])
    })

    it('reports the failure if it happens again, instead of trying for ever', async () => {
      const { audio, errors } = setup()
      await audio.play()
      element.error = { code: 4 }
      element.emit('error')
      await flush()
      element.emit('error')
      await flush()
      expect(getStream).toHaveBeenCalledTimes(2)
      expect(errors).toHaveLength(1)
    })

    it('says so if Qobuz will not give a fresh address', async () => {
      const { audio, errors } = setup()
      await audio.play()
      getStream.mockRejectedValueOnce(new Error('signed out'))
      element.error = { code: 4 }
      element.emit('error')
      await flush()
      expect(errors).toEqual(['Qobuz could not stream this track. Try playing it again.'])
    })

    it('does not report a failure for a track that has been replaced meanwhile', async () => {
      const { audio, errors } = setup()
      await audio.play()
      getStream.mockImplementationOnce(() => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('x')), 5)))
      element.error = { code: 4 }
      element.emit('error')
      audio.src = 'qobuz:456'
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(errors).toEqual([])
    })
  })

  it('reports errors that are not about the address (a damaged file) straight away', async () => {
    const { audio, errors } = setup()
    await audio.play()
    element.error = { code: 3 }
    element.emit('error')
    expect(getStream).toHaveBeenCalledOnce()
    expect(errors).toHaveLength(1)
    expect(audio.error).toEqual({ code: 3 })
  })

  it('reports an error from before the stream was ready without trying to recover', () => {
    const { errors } = setup()
    element.error = { code: 4 }
    element.emit('error')
    expect(getStream).not.toHaveBeenCalled()
    expect(errors).toHaveLength(1)
  })
})
