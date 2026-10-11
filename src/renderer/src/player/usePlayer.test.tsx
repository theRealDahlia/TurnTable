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
const setup = () => {
  audio = new FakeAudio()
  return renderHook(() => usePlayer({ createAudio: () => audio as unknown as HTMLAudioElement }))
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

    it('queues Spotify and local tracks together, in order', () => {
      const { result } = setup()
      const queue = [track(1), spotifyTrack(), track(2)]

      act(() => result.current.play(queue[0]!, queue))
      act(() => result.current.next())
      expect(audio.src).toBe(`spotify:track:${SPOTIFY_ID}`)
      act(() => result.current.next())
      expect(audio.src).toBe(urlOf(queue[2]!))
    })

    it('shows the explanation a source gives for its own failure, not a generic one', () => {
      const { result } = setup()
      act(() => result.current.play(spotifyTrack()))

      act(() => void audio.dispatchEvent(new CustomEvent('error', { detail: 'Spotify Premium is required to play music in TurnTable.' })))

      expect(result.current).toMatchObject({ status: 'error', error: 'Spotify Premium is required to play music in TurnTable.' })
    })

    it('shows a clean message when starting a Spotify track is refused', async () => {
      const { result } = setup()
      audio.playResult = () => Promise.reject(new Error("Error invoking remote method 'spotify:play': Error: Reconnect Spotify to allow playback in TurnTable."))

      act(() => result.current.play(spotifyTrack()))
      await flush()

      expect(result.current).toMatchObject({ status: 'error', error: 'Reconnect Spotify to allow playback in TurnTable.' })
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
