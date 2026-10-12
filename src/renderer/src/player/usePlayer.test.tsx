// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@shared/types'
import { usePlayer } from './usePlayer'

/** Just enough of HTMLAudioElement to drive the hook deterministically. */
class FakeAudio extends EventTarget {
  src = ''
  currentTime = 0
  duration = NaN
  volume = 1
  paused = true
  ended = false
  error: { code: number } | null = null
  playResult: () => Promise<void> = () => Promise.resolve()

  play(): Promise<void> {
    this.paused = false
    return this.playResult().then(() => {
      this.emit('playing')
    })
  }
  pause(): void {
    if (this.paused) return
    this.paused = true
    this.emit('pause')
  }
  removeAttribute(): void {
    this.src = ''
  }
  load(): void {}
  emit(type: string): void {
    this.dispatchEvent(new Event(type))
  }
}

const track = (n: number, overrides: Partial<Track> = {}): Track => ({
  id: String(n).padStart(24, '0'),
  providerId: 'local',
  title: `Song ${n}`,
  artists: ['A'],
  durationMs: 100_000,
  quality: { codec: 'flac', lossless: true },
  ...overrides
})
const urlOf = (t: Track): string => `turntable-media://audio/${t.id}`

let audio: FakeAudio
const setup = (random?: () => number) => {
  audio = new FakeAudio()
  return renderHook(() => usePlayer({ createAudio: () => audio as unknown as HTMLAudioElement, random }))
}

/** A repeatable source of randomness: the numbers cycle through `values`. */
const sequence = (...values: number[]): (() => number) => {
  let i = 0
  return () => values[i++ % values.length]!
}
const flush = () => act(async () => {})

beforeEach(() => vi.useRealTimers())
afterEach(cleanup)

describe('usePlayer', () => {
  it('starts idle', () => {
    const { result } = setup()
    expect(result.current).toMatchObject({ status: 'idle', hasNext: false, hasPrevious: false, volume: 1 })
    expect(result.current.track).toBeUndefined()
  })

  it('loads the track from the media URL and reports loading, then playing', async () => {
    const { result } = setup()
    const t = track(1)

    act(() => result.current.play(t))
    expect(audio.src).toBe(urlOf(t))
    expect(result.current).toMatchObject({ status: 'loading', track: t, duration: 100 })

    await flush()
    expect(result.current.status).toBe('playing')
  })

  it('pauses and resumes with toggle()', async () => {
    const { result } = setup()
    act(() => result.current.play(track(1)))
    await flush()

    act(() => result.current.toggle())
    expect(result.current.status).toBe('paused')

    act(() => result.current.toggle())
    await flush()
    expect(result.current.status).toBe('playing')
  })

  it('does nothing on toggle() before anything has been played', () => {
    const { result } = setup()
    act(() => result.current.toggle())
    expect(result.current.status).toBe('idle')
  })

  it('tracks time and the real duration reported by the file', async () => {
    const { result } = setup()
    act(() => result.current.play(track(1)))
    await flush()

    act(() => {
      audio.currentTime = 12.5
      audio.emit('timeupdate')
      audio.duration = 101.2
      audio.emit('durationchange')
    })
    expect(result.current).toMatchObject({ currentTime: 12.5, duration: 101.2 })
  })

  it('ignores a non-finite duration while the file is still loading', async () => {
    const { result } = setup()
    act(() => result.current.play(track(1)))
    act(() => audio.emit('durationchange')) // duration is NaN
    expect(result.current.duration).toBe(100)
  })

  describe('queue', () => {
    const queue = [track(1), track(2), track(3)]

    it('reports whether there is a next and previous track', () => {
      const { result } = setup()
      act(() => result.current.play(queue[1]!, queue))
      expect(result.current).toMatchObject({ hasNext: true, hasPrevious: true })

      act(() => result.current.play(queue[0]!, queue))
      expect(result.current).toMatchObject({ hasNext: true, hasPrevious: false })

      act(() => result.current.play(queue[2]!, queue))
      expect(result.current).toMatchObject({ hasNext: false, hasPrevious: true })
    })

    it('moves forward and stops at the end of the queue', async () => {
      const { result } = setup()
      act(() => result.current.play(queue[1]!, queue))

      act(() => result.current.next())
      expect(audio.src).toBe(urlOf(queue[2]!))
      expect(result.current.track).toBe(queue[2])

      act(() => result.current.next())
      expect(audio.src).toBe(urlOf(queue[2]!))
    })

    it('goes back, but restarts the current track when more than 3 seconds in', async () => {
      const { result } = setup()
      act(() => result.current.play(queue[1]!, queue))

      audio.currentTime = 10
      act(() => result.current.previous())
      expect(audio.currentTime).toBe(0)
      expect(result.current.track).toBe(queue[1])

      act(() => result.current.previous())
      expect(result.current.track).toBe(queue[0])
    })

    it('restarts instead of going back from the first track', () => {
      const { result } = setup()
      act(() => result.current.play(queue[0]!, queue))
      audio.currentTime = 1
      act(() => result.current.previous())
      expect(audio.currentTime).toBe(0)
      expect(result.current.track).toBe(queue[0])
    })

    it('advances automatically when a track ends, and stops after the last one', async () => {
      const { result } = setup()
      act(() => result.current.play(queue[1]!, queue))

      act(() => audio.emit('ended'))
      expect(result.current.track).toBe(queue[2])

      audio.ended = true
      act(() => audio.emit('ended'))
      expect(result.current).toMatchObject({ track: queue[2], status: 'paused' })
    })

    it('leaves unplayable tracks out of the queue', () => {
      const alac = track(9, { quality: { codec: 'alac', lossless: true } })
      const spotify = track(8, { providerId: 'spotify', quality: undefined })
      const { result } = setup()

      act(() => result.current.play(queue[0]!, [queue[0]!, alac, spotify, queue[1]!]))
      act(() => result.current.next())
      expect(result.current.track).toBe(queue[1])
      expect(result.current.hasNext).toBe(false)
    })

    it('plays just the track when it is not in the given queue', () => {
      const { result } = setup()
      act(() => result.current.play(track(7), queue))
      expect(result.current).toMatchObject({ hasNext: false, hasPrevious: false })
    })
  })

  describe('Spotify tracks', () => {
    const SPOTIFY_ID = '4iV5W9uYEdYUVa79Axb7Rh'
    const spotifyTrack = (overrides: Partial<Track> = {}): Track => ({
      id: SPOTIFY_ID,
      providerId: 'spotify',
      title: 'Spotify Song',
      artists: ['A'],
      durationMs: 100_000,
      ...overrides
    })

    it('loads a Spotify track by its URI', () => {
      const { result } = setup()
      act(() => result.current.play(spotifyTrack()))
      expect(audio.src).toBe(`spotify:track:${SPOTIFY_ID}`)
      expect(result.current.status).toBe('loading')
    })

    it("keeps the queue to the played track's own service, skipping the other services' tracks", () => {
      const { result } = setup()
      const queue = [track(1), spotifyTrack(), track(2)]

      act(() => result.current.play(queue[0]!, queue))
      act(() => result.current.next())
      expect(audio.src).toBe(urlOf(queue[2]!))
      expect(result.current.hasNext).toBe(false)
    })

    it('queues Spotify tracks together, in order', () => {
      const { result } = setup()
      const second = { ...spotifyTrack(), id: 'y'.repeat(22), title: 'Second' }
      const queue = [spotifyTrack(), track(1), second]

      act(() => result.current.play(queue[0]!, queue))
      act(() => result.current.next())
      expect(audio.src).toBe(`spotify:track:${'y'.repeat(22)}`)
    })

    it('shows the explanation a source gives for its own failure, not a generic one', () => {
      const { result } = setup()
      act(() => result.current.play(spotifyTrack()))

      act(() => void audio.dispatchEvent(new CustomEvent('error', { detail: 'Spotify Premium is required to play music in Muze.' })))

      expect(result.current).toMatchObject({ status: 'error', error: 'Spotify Premium is required to play music in Muze.' })
    })

    it('shows a clean message when starting a Spotify track is refused', async () => {
      const { result } = setup()
      audio.playResult = () => Promise.reject(new Error("Error invoking remote method 'spotify:play': Error: Reconnect Spotify to allow playback in Muze."))

      act(() => result.current.play(spotifyTrack()))
      await flush()

      expect(result.current).toMatchObject({ status: 'error', error: 'Reconnect Spotify to allow playback in Muze.' })
    })
  })

  describe('refusing and failing', () => {
    it.each([
      ['a format Chromium cannot decode', track(1, { quality: { codec: 'alac', lossless: true } })],
      ['a track with unknown format', track(2, { quality: undefined })],
      ['a Spotify track with a malformed id', track(3, { providerId: 'spotify', id: 'not-a-spotify-id' })],
      ['a track from a service without playback', track(4, { providerId: 'qobuz' })]
    ])('refuses %s without touching the audio element', (_label, t) => {
      const { result } = setup()
      act(() => result.current.play(t))
      expect(result.current.status).toBe('error')
      expect(result.current.error).toContain("can't be played")
      expect(audio.src).toBe('')
    })

    it.each([
      [4, 'This audio format is not supported.'],
      [3, 'This file is damaged or could not be decoded.'],
      [2, 'The audio could not be loaded.'],
      [1, 'Playback failed.']
    ])('turns media error code %i into a readable message', (code, message) => {
      const { result } = setup()
      act(() => result.current.play(track(1)))
      audio.error = { code }
      act(() => audio.emit('error'))
      expect(result.current).toMatchObject({ status: 'error', error: message })
    })

    it('reports a rejected play() (e.g. blocked by the browser)', async () => {
      const { result } = setup()
      audio.playResult = () => Promise.reject(new DOMException('Not allowed', 'NotAllowedError'))
      act(() => result.current.play(track(1)))
      await flush()
      expect(result.current).toMatchObject({ status: 'error', error: 'Not allowed' })
    })

    it('ignores the AbortError caused by switching tracks quickly', async () => {
      const { result } = setup()
      audio.playResult = () => Promise.reject(new DOMException('Interrupted', 'AbortError'))
      act(() => result.current.play(track(1)))
      await flush()
      expect(result.current.status).toBe('loading')
    })

    it('ignores a late failure from a track that has since been replaced', async () => {
      const { result } = setup()
      let rejectFirst!: (e: Error) => void
      audio.playResult = () => new Promise((_, reject) => (rejectFirst = reject))
      act(() => result.current.play(track(1)))

      audio.playResult = () => Promise.resolve()
      act(() => result.current.play(track(2)))
      await flush()
      await act(async () => rejectFirst(new Error('stale failure')))

      expect(result.current).toMatchObject({ status: 'playing', error: undefined, track: track(2) })
    })

    it('recovers when another track is played after an error', async () => {
      const { result } = setup()
      act(() => result.current.play(track(1, { quality: undefined })))
      expect(result.current.status).toBe('error')

      act(() => result.current.play(track(2)))
      await flush()
      expect(result.current).toMatchObject({ status: 'playing', error: undefined })
    })
  })

  describe('seek and volume', () => {
    it('seeks within the file and clamps to its bounds', async () => {
      const { result } = setup()
      act(() => result.current.play(track(1)))
      audio.duration = 100

      act(() => result.current.seek(42))
      expect(audio.currentTime).toBe(42)
      expect(result.current.currentTime).toBe(42)

      act(() => result.current.seek(-5))
      expect(audio.currentTime).toBe(0)
      act(() => result.current.seek(500))
      expect(audio.currentTime).toBe(100)
    })

    it('ignores a non-finite seek position', () => {
      const { result } = setup()
      act(() => result.current.play(track(1)))
      audio.currentTime = 7
      act(() => result.current.seek(NaN))
      expect(audio.currentTime).toBe(7)
    })

    it('sets the volume on the element, clamped to 0..1', () => {
      const { result } = setup()
      act(() => result.current.setVolume(0.4))
      expect(audio.volume).toBe(0.4)
      expect(result.current.volume).toBe(0.4)

      act(() => result.current.setVolume(3))
      expect(audio.volume).toBe(1)
      act(() => result.current.setVolume(-1))
      expect(audio.volume).toBe(0)
      act(() => result.current.setVolume(NaN))
      expect(audio.volume).toBe(1)
    })
  })

  it('stops the audio and releases the file on unmount', async () => {
    const { result, unmount } = setup()
    act(() => result.current.play(track(1)))
    await flush()
    unmount()

    expect(audio.paused).toBe(true)
    expect(audio.src).toBe('')
  })
})

describe('usePlayer clear', () => {
  it('stops playing and forgets the track and queue, keeping volume and shuffle', async () => {
    const { result } = setup()
    act(() => result.current.setVolume(0.4))
    act(() => result.current.setShuffle(true))
    act(() => result.current.play(track(1), [track(1), track(2)]))
    await flush()
    expect(result.current.status).toBe('playing')

    act(() => result.current.clear())

    expect(audio.src).toBe('')
    expect(audio.paused).toBe(true)
    expect(result.current).toMatchObject({ status: 'idle', hasNext: false, hasPrevious: false, volume: 0.4, shuffle: true })
    expect(result.current.track).toBeUndefined()
    // There is no queue left to move through, and the toggle has nothing to resume.
    act(() => result.current.next())
    act(() => result.current.toggle())
    expect(result.current.track).toBeUndefined()
    expect(audio.src).toBe('')
  })

  it('is not undone by a track that was still loading', async () => {
    const { result } = setup()
    let fail!: (error: Error) => void
    audio.playResult = () => new Promise<void>((_resolve, reject) => (fail = reject))
    act(() => result.current.play(track(1)))

    act(() => result.current.clear())
    await act(async () => fail(new Error('late failure')))

    expect(result.current.status).toBe('idle')
    expect(result.current.error).toBeUndefined()
  })
})

describe('usePlayer shuffle', () => {
  const queue = [track(1), track(2), track(3), track(4), track(5)]
  const playing = (result: { current: ReturnType<typeof usePlayer> }): string | undefined => result.current.track?.title

  /** Skips with next() `skips` times (once through the queue by default), returning the titles in the order they came. */
  async function playOut(result: { current: ReturnType<typeof usePlayer> }, skips = queue.length - 1): Promise<(string | undefined)[]> {
    const seen = [playing(result)]
    for (let i = 0; i < skips; i++) {
      act(() => result.current.next())
      await flush()
      seen.push(playing(result))
    }
    return seen
  }

  it('is off to begin with', () => {
    expect(setup().result.current.shuffle).toBe(false)
  })

  it('plays in the listed order while off', async () => {
    const { result } = setup()
    act(() => result.current.play(queue[1]!, queue))
    await flush()
    expect(await playOut(result, 3)).toEqual(['Song 2', 'Song 3', 'Song 4', 'Song 5'])
    expect(result.current.hasNext).toBe(false)
  })

  it('shuffling a queue that is playing keeps the current song and reorders the rest, all of it', async () => {
    const { result } = setup(sequence(0.1, 0.9, 0.4, 0.7))
    act(() => result.current.play(queue[2]!, queue))
    await flush()

    act(() => result.current.setShuffle(true))
    expect(result.current.shuffle).toBe(true)
    expect(playing(result)).toBe('Song 3')
    expect(audio.src).toBe(urlOf(queue[2]!))

    const order = await playOut(result)
    expect(order[0]).toBe('Song 3')
    // Every other song comes up exactly once, including the ones listed before the current one.
    expect([...order].sort()).toEqual(['Song 1', 'Song 2', 'Song 3', 'Song 4', 'Song 5'])
    expect(order).not.toEqual(['Song 3', 'Song 4', 'Song 5', 'Song 1', 'Song 2'])
  })

  it('does not interrupt the song that is playing when shuffle is switched on or off', async () => {
    const { result } = setup()
    act(() => result.current.play(queue[0]!, queue))
    await flush()
    audio.currentTime = 42
    const loads = audio.src

    act(() => result.current.setShuffle(true))
    act(() => result.current.setShuffle(false))

    expect(result.current.status).toBe('playing')
    expect(audio.currentTime).toBe(42)
    expect(audio.src).toBe(loads)
  })

  it('starts a shuffled queue with the song that was chosen, then plays the others in random order', async () => {
    const { result } = setup(sequence(0.3, 0.8, 0.1))
    act(() => result.current.setShuffle(true))
    act(() => result.current.play(queue[3]!, queue))
    await flush()

    expect(playing(result)).toBe('Song 4')
    expect(result.current.hasPrevious).toBe(false)
    const order = await playOut(result)
    expect([...order].sort()).toEqual(['Song 1', 'Song 2', 'Song 3', 'Song 4', 'Song 5'])
  })

  it('shuffles differently each time, but can be repeated with the same randomness', async () => {
    const first = setup(sequence(0.9, 0.1, 0.6, 0.3))
    act(() => first.result.current.setShuffle(true))
    act(() => first.result.current.play(queue[0]!, queue))
    await flush()
    const a = await playOut(first.result)
    cleanup()

    const second = setup(sequence(0.9, 0.1, 0.6, 0.3))
    act(() => second.result.current.setShuffle(true))
    act(() => second.result.current.play(queue[0]!, queue))
    await flush()
    expect(await playOut(second.result)).toEqual(a)
  })

  it('goes back through what was just played with previous()', async () => {
    const { result } = setup(sequence(0.2, 0.6, 0.9))
    act(() => result.current.setShuffle(true))
    act(() => result.current.play(queue[0]!, queue))
    await flush()
    act(() => result.current.next())
    await flush()
    const second = playing(result)
    act(() => result.current.next())
    await flush()
    expect(result.current.hasPrevious).toBe(true)

    audio.currentTime = 0
    act(() => result.current.previous())
    await flush()
    expect(playing(result)).toBe(second)
  })

  it('never runs out of songs to skip to', async () => {
    const { result } = setup()
    act(() => result.current.setShuffle(true))
    act(() => result.current.play(queue[0]!, queue))
    await flush()

    // Far more skips than there are songs.
    for (let i = 0; i < queue.length * 6; i++) {
      expect(result.current.hasNext).toBe(true)
      act(() => result.current.next())
      await flush()
      expect(result.current.status).toBe('playing')
    }
    expect(result.current.hasNext).toBe(true)
  })

  it('plays every song once before it plays any twice, pass after pass', async () => {
    const { result } = setup()
    act(() => result.current.setShuffle(true))
    act(() => result.current.play(queue[0]!, queue))
    await flush()

    const order = await playOut(result, queue.length * 4 - 1)

    for (let pass = 0; pass < 4; pass++) {
      const titles = order.slice(pass * queue.length, (pass + 1) * queue.length)
      expect([...titles].sort()).toEqual(['Song 1', 'Song 2', 'Song 3', 'Song 4', 'Song 5'])
    }
  })

  it('starts each new pass in a different order, and never repeats a song back to back', async () => {
    const { result } = setup(sequence(0.1, 0.5, 0.9, 0.3, 0.7))
    act(() => result.current.setShuffle(true))
    act(() => result.current.play(queue[0]!, queue))
    await flush()

    const order = await playOut(result, 60)

    for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1])
    const passes = Array.from({ length: 12 }, (_, i) => order.slice(i * 5, i * 5 + 5).join())
    expect(new Set(passes).size).toBeGreaterThan(1)
  })

  it('does not repeat the song just played at the start of a new pass, even when chance would', async () => {
    // Randomness that always asks for the same song first would put the last song first again.
    const { result } = setup(() => 0)
    act(() => result.current.setShuffle(true))
    act(() => result.current.play(queue[0]!, queue))
    await flush()

    const order = await playOut(result, 40)
    for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1])
  })

  it('goes back across the start of a new pass', async () => {
    const { result } = setup(sequence(0.2, 0.8, 0.5))
    act(() => result.current.setShuffle(true))
    act(() => result.current.play(queue[0]!, queue))
    await flush()
    const order = await playOut(result, queue.length + 1) // into the second pass
    expect(order).toHaveLength(queue.length + 2)

    for (let i = order.length - 2; i >= 0; i--) {
      audio.currentTime = 0
      act(() => result.current.previous())
      await flush()
      expect(playing(result)).toBe(order[i])
    }
    expect(result.current.hasPrevious).toBe(false)
  })

  it('keeps alternating between two songs for ever', async () => {
    const { result } = setup()
    act(() => result.current.setShuffle(true))
    act(() => result.current.play(queue[0]!, [queue[0]!, queue[1]!]))
    await flush()
    const order = await playOut(result, 9)
    expect(new Set(order)).toEqual(new Set(['Song 1', 'Song 2']))
    for (let i = 1; i < order.length; i++) expect(order[i]).not.toBe(order[i - 1])
  })

  it('does not loop a single song, which has nothing to skip to', async () => {
    const { result } = setup()
    act(() => result.current.setShuffle(true))
    act(() => result.current.play(queue[0]!))
    await flush()
    expect(result.current.hasNext).toBe(false)

    act(() => result.current.next())
    await flush()
    expect(playing(result)).toBe('Song 1')
    act(() => audio.emit('ended'))
    expect(result.current.status).toBe('paused')
  })

  it('carries on by itself when a song ends at the end of a pass', async () => {
    const { result } = setup()
    act(() => result.current.setShuffle(true))
    act(() => result.current.play(queue[0]!, queue))
    await flush()
    await playOut(result) // to the last song of the first pass
    const last = playing(result)

    act(() => audio.emit('ended'))
    await flush()

    expect(result.current.status).toBe('playing')
    expect(playing(result)).not.toBe(last)
  })

  it('goes back to the listed order, from the song that is playing, after several passes', async () => {
    const { result } = setup()
    act(() => result.current.setShuffle(true))
    act(() => result.current.play(queue[0]!, queue))
    await flush()
    await playOut(result, queue.length * 2)
    const current = result.current.track!
    const listedIndex = queue.findIndex((t) => t.id === current.id)

    act(() => result.current.setShuffle(false))

    expect(result.current.hasNext).toBe(listedIndex < queue.length - 1)
    expect(result.current.hasPrevious).toBe(listedIndex > 0)
    expect(result.current.track).toEqual(current)
  })

  it('stops being endless when shuffle is turned off at the end of a pass', async () => {
    const { result } = setup()
    act(() => result.current.setShuffle(true))
    act(() => result.current.play(queue[0]!, queue))
    await flush()
    await playOut(result)
    expect(result.current.hasNext).toBe(true)

    act(() => result.current.setShuffle(false))
    const atListed = queue.findIndex((t) => t.id === result.current.track!.id)
    expect(result.current.hasNext).toBe(atListed < queue.length - 1)
  })

  it('keeps working through thousands of skips without keeping every song it has played', async () => {
    const { result } = setup()
    act(() => result.current.setShuffle(true))
    act(() => result.current.play(queue[0]!, queue))
    await flush()

    for (let i = 0; i < 2300; i++) act(() => result.current.next())
    await flush()

    expect(result.current.status).toBe('playing')
    expect(result.current.hasNext).toBe(true)
    expect(result.current.hasPrevious).toBe(true)
    const before = playing(result)
    audio.currentTime = 0
    act(() => result.current.previous())
    await flush()
    expect(playing(result)).not.toBe(before)
  })

  it('moves on to a random song by itself when one ends', async () => {
    const { result } = setup(sequence(0.5))
    act(() => result.current.setShuffle(true))
    act(() => result.current.play(queue[0]!, queue))
    await flush()
    const first = playing(result)

    act(() => audio.emit('ended'))
    await flush()

    expect(playing(result)).not.toBe(first)
    expect(result.current.status).toBe('playing')
  })

  it('goes back to the listed order, from the song that is playing, when switched off (short run)', async () => {
    const { result } = setup(sequence(0.9, 0.1, 0.5))
    act(() => result.current.setShuffle(true))
    act(() => result.current.play(queue[1]!, queue))
    await flush()
    act(() => result.current.next())
    await flush()
    const current = result.current.track!
    const listedIndex = queue.findIndex((t) => t.id === current.id)

    act(() => result.current.setShuffle(false))
    expect(result.current.shuffle).toBe(false)
    expect(result.current.hasPrevious).toBe(listedIndex > 0)
    expect(result.current.hasNext).toBe(listedIndex < queue.length - 1)
    if (listedIndex < queue.length - 1) {
      act(() => result.current.next())
      await flush()
      expect(playing(result)).toBe(queue[listedIndex + 1]!.title)
    }
  })

  it('remembers the choice for the next song picked, even before anything is playing', async () => {
    const { result } = setup(sequence(0.7, 0.2))
    act(() => result.current.setShuffle(true))
    expect(result.current.shuffle).toBe(true)
    expect(result.current).toMatchObject({ hasNext: false, hasPrevious: false })

    act(() => result.current.play(queue[0]!, queue))
    await flush()
    expect(result.current.hasNext).toBe(true)
    expect(result.current.hasPrevious).toBe(false)
  })

  it('has nothing to skip to with a single song', async () => {
    const { result } = setup()
    act(() => result.current.setShuffle(true))
    act(() => result.current.play(queue[0]!))
    await flush()
    expect(result.current).toMatchObject({ hasNext: false, hasPrevious: false })
  })

  it('leaves out songs that cannot be played, shuffled or not', async () => {
    const unplayable = track(9, { quality: { codec: 'alac', lossless: true } })
    const { result } = setup()
    act(() => result.current.setShuffle(true))
    act(() => result.current.play(queue[0]!, [...queue, unplayable]))
    await flush()
    expect(await playOut(result)).not.toContain('Song 9')
  })

  it('refuses to start a song that cannot be played, without disturbing the queue', async () => {
    const { result } = setup()
    act(() => result.current.play(queue[0]!, queue))
    await flush()
    act(() => result.current.setShuffle(true))

    act(() => result.current.play(track(9, { quality: { codec: 'alac', lossless: true } })))

    expect(result.current.status).toBe('error')
    expect(result.current.shuffle).toBe(true)
  })

  it("never shuffles in another service's tracks", async () => {
    const local = track(1)
    const other = track(1, { providerId: 'spotify', id: 'x'.repeat(22) })
    const { result } = setup()
    act(() => result.current.setShuffle(true))
    act(() => result.current.play(local, [local, other]))
    await flush()
    expect(result.current.hasNext).toBe(false)
  })
})
