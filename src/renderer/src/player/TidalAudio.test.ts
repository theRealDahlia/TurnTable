import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TidalPlayerApi, TidalPlayerEvent } from '@shared/tidalPlayer'
import { errorMessageOf } from './media'
import { TidalAudio } from './TidalAudio'

const ID = '4iV5W9uYEdYUVa79Axb7Rh'
const OTHER = '1301WleyT98MSxVHPZCA6M'
const URI = `tidal:${ID}`

type State = Extract<TidalPlayerEvent, { type: 'state' }>
const state = (overrides: Partial<State> = {}): State => ({
  type: 'state',
  trackId: ID,
  paused: false,
  positionMs: 1500,
  durationMs: 200_000,
  ended: false,
  ...overrides
})

function setup(options: { startTimeoutMs?: number } = {}) {
  let listener: ((event: TidalPlayerEvent) => void) | undefined
  const unsubscribe = vi.fn(() => void (listener = undefined))
  const api = {
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue(undefined),
    setVolume: vi.fn().mockResolvedValue(undefined),
    onEvent: vi.fn((cb: (event: TidalPlayerEvent) => void) => {
      listener = cb
      return unsubscribe
    })
  }
  let time = 1_000_000
  const audio = new TidalAudio(() => api as unknown as TidalPlayerApi, { ...options, now: () => time })
  const events: string[] = []
  const errors: string[] = []
  for (const type of ['playing', 'pause', 'timeupdate', 'durationchange', 'ended']) audio.addEventListener(type, () => events.push(type))
  audio.addEventListener('error', (event) => errors.push(errorMessageOf(event) ?? '?'))
  return {
    audio,
    api,
    events,
    errors,
    unsubscribe,
    send: (event: TidalPlayerEvent) => listener?.(event),
    hasListener: () => listener !== undefined,
    advance: (ms: number) => void (time += ms)
  }
}

/** Starts a track and has TIDAL confirm it is playing. */
async function startPlaying(t: ReturnType<typeof setup>): Promise<void> {
  t.audio.src = URI
  await t.audio.play()
  t.send(state())
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('TidalAudio source', () => {
  it('starts empty and paused', () => {
    const { audio } = setup()
    expect(audio).toMatchObject({ src: '', paused: true, ended: false, currentTime: 0, volume: 1, error: null })
    expect(audio.duration).toBeNaN()
  })

  it('accepts a TIDAL track URI', () => {
    const { audio } = setup()
    audio.src = URI
    expect(audio.src).toBe(URI)
  })

  it.each(['', 'https://example.com/a.mp3', 'tidal:', 'tidal:has space', `tidal:album:${ID}`, `spotify:track:${ID}`])('rejects %j, and refuses to play it', async (src) => {
    const { audio, api } = setup()
    audio.src = src
    expect(audio.src).toBe('')
    await expect(audio.play()).rejects.toThrow('not a valid TIDAL track')
    expect(api.play).not.toHaveBeenCalled()
  })
})

describe('TidalAudio starting playback', () => {
  it('asks TIDAL to play the track and subscribes to its events', async () => {
    const t = setup()
    t.audio.src = URI
    await t.audio.play()

    expect(t.api.play).toHaveBeenCalledExactlyOnceWith(ID)
    expect(t.api.onEvent).toHaveBeenCalledOnce()
    expect(t.audio.paused).toBe(false)
  })

  it('announces playing, the duration and the position once TIDAL reports the track', async () => {
    const t = setup()
    await startPlaying(t)

    expect(t.events).toEqual(['durationchange', 'playing', 'timeupdate'])
    expect(t.audio.duration).toBe(200)
    expect(t.audio.currentTime).toBe(1.5)
    expect(t.audio.paused).toBe(false)
  })

  it('does not announce playing again for every state report, and keeps the time moving', async () => {
    const t = setup()
    await startPlaying(t)
    t.events.length = 0

    t.send(state({ positionMs: 2000 }))
    t.send(state({ positionMs: 2500 }))

    expect(t.events).toEqual(['timeupdate', 'timeupdate'])
    expect(t.audio.currentTime).toBe(2.5)
  })

  it('ignores reports for other tracks, such as the one just left', async () => {
    const t = setup()
    t.audio.src = URI
    await t.audio.play()

    t.send(state({ trackId: OTHER, positionMs: 99_000 }))

    expect(t.events).toEqual([])
    expect(t.audio.currentTime).toBe(0)
  })

  it('propagates a refusal from TIDAL, and can be retried', async () => {
    const t = setup()
    t.audio.src = URI
    t.api.play.mockRejectedValueOnce(new Error('TIDAL: Premium required (status 403)'))

    await expect(t.audio.play()).rejects.toThrow('Premium required')
    expect(t.audio.paused).toBe(true)

    await t.audio.play()
    expect(t.api.play).toHaveBeenCalledTimes(2)
  })

  it('ignores the outcome of a start that was superseded by another track', async () => {
    const t = setup({ startTimeoutMs: 1000 })
    let finish!: () => void
    t.api.play.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)))
    t.audio.src = URI
    const starting = t.audio.play()

    t.audio.src = `tidal:${OTHER}`
    finish()
    await starting
    await vi.advanceTimersByTimeAsync(5000)

    expect(t.errors).toEqual([])
  })

  it('stops a track the user paused while TIDAL was still starting it', async () => {
    const t = setup()
    let finish!: () => void
    t.api.play.mockReturnValueOnce(new Promise<void>((resolve) => (finish = resolve)))
    t.audio.src = URI
    const starting = t.audio.play()

    t.audio.pause()
    finish()
    await starting

    expect(t.api.pause).toHaveBeenCalledTimes(2)
  })

  it('reports an error if TIDAL never starts the track, but not if it did', async () => {
    const slow = setup({ startTimeoutMs: 1000 })
    slow.audio.src = URI
    await slow.audio.play()
    await vi.advanceTimersByTimeAsync(1001)
    expect(slow.errors).toEqual(["TIDAL didn't start playing. Try again."])
    expect(slow.audio.paused).toBe(true)

    const ok = setup({ startTimeoutMs: 1000 })
    await startPlaying(ok)
    await vi.advanceTimersByTimeAsync(5000)
    expect(ok.errors).toEqual([])
  })
})

describe('TidalAudio pause and resume', () => {
  it('pauses TIDAL and announces it once', async () => {
    const t = setup()
    await startPlaying(t)
    t.events.length = 0

    t.audio.pause()
    t.audio.pause()

    expect(t.api.pause).toHaveBeenCalledOnce()
    expect(t.events).toEqual(['pause'])
    expect(t.audio.paused).toBe(true)
  })

  it('resumes through TIDAL rather than starting the track again, and announces playing', async () => {
    const t = setup()
    await startPlaying(t)
    t.audio.pause()
    t.advance(2000)
    t.events.length = 0

    await t.audio.play()
    t.send(state({ positionMs: 3000 }))

    expect(t.api.resume).toHaveBeenCalledOnce()
    expect(t.api.play).toHaveBeenCalledOnce()
    expect(t.events).toContain('playing')
    expect(t.audio.paused).toBe(false)
  })

  it('does not let a report that was already in flight undo a pause the user just made', async () => {
    const t = setup()
    await startPlaying(t)
    t.audio.pause()
    t.events.length = 0

    t.send(state({ paused: false, positionMs: 2000 }))

    expect(t.audio.paused).toBe(true)
    expect(t.events).toEqual(['timeupdate'])
  })

  it('trusts TIDAL again once the grace period has passed (e.g. paused from another device)', async () => {
    const t = setup()
    await startPlaying(t)
    t.advance(5000)
    t.events.length = 0

    t.send(state({ paused: true, positionMs: 9000 }))

    expect(t.audio.paused).toBe(true)
    expect(t.events).toEqual(['pause', 'timeupdate'])
  })
})

describe('TidalAudio end of track', () => {
  it('announces the end when a track that was playing finishes', async () => {
    const t = setup()
    await startPlaying(t)
    t.events.length = 0

    t.send(state({ paused: true, positionMs: 0, ended: true }))

    expect(t.events).toEqual(['ended'])
    expect(t.audio.ended).toBe(true)
    expect(t.audio.paused).toBe(true)
  })

  it('does not treat the very first report as an ending, even if it looks like one', async () => {
    const t = setup()
    t.audio.src = URI
    await t.audio.play()

    t.send(state({ paused: true, positionMs: 0, ended: true }))

    expect(t.events).not.toContain('ended')
    expect(t.audio.ended).toBe(false)
  })

  it('clears the ended flag when the track is played again', async () => {
    const t = setup()
    await startPlaying(t)
    t.send(state({ paused: true, positionMs: 0, ended: true }))

    t.audio.src = URI
    await t.audio.play()

    expect(t.audio.ended).toBe(false)
  })
})

describe('TidalAudio errors', () => {
  it('turns a TIDAL error into an error event with its message, and stops listening for state', async () => {
    const t = setup()
    await startPlaying(t)
    t.events.length = 0

    t.send({ type: 'error', kind: 'authentication', message: 'TIDAL rejected the sign-in. Reconnect TIDAL and try again.' })
    t.send(state({ positionMs: 9000 }))

    expect(t.errors).toEqual(['TIDAL rejected the sign-in. Reconnect TIDAL and try again.'])
    expect(t.events).toEqual([])
    expect(t.audio.paused).toBe(true)
  })

  it('ignores errors when nothing of ours is playing', () => {
    const t = setup()
    t.audio.src = URI
    t.send({ type: 'error', kind: 'playback', message: 'late' })
    expect(t.errors).toEqual([])
  })

  it('ignores readiness events', async () => {
    const t = setup()
    t.audio.src = URI
    await t.audio.play()
    t.send({ type: 'ready' })
    expect(t.errors).toEqual([])
    expect(t.events).toEqual([])
  })
})

describe('TidalAudio seek and volume', () => {
  it('seeks TIDAL in whole milliseconds once playing, and remembers the position', async () => {
    const t = setup()
    await startPlaying(t)

    t.audio.currentTime = 12.3456
    expect(t.api.seek).toHaveBeenCalledExactlyOnceWith(12346)
    expect(t.audio.currentTime).toBe(12.3456)
  })

  it('does not call TIDAL to seek before anything has started', () => {
    const t = setup()
    t.audio.currentTime = 30
    expect(t.api.seek).not.toHaveBeenCalled()
  })

  it('applies a volume chosen before playback once it starts, and changes it live afterwards', async () => {
    const t = setup()
    t.audio.volume = 0.4
    expect(t.api.setVolume).not.toHaveBeenCalled()

    t.audio.src = URI
    await t.audio.play()
    expect(t.api.setVolume).toHaveBeenCalledWith(0.4)

    t.audio.volume = 0.8
    expect(t.api.setVolume).toHaveBeenLastCalledWith(0.8)
    expect(t.audio.volume).toBe(0.8)
  })

  it('leaves TIDAL at full volume when nothing was changed', async () => {
    const t = setup()
    t.audio.src = URI
    await t.audio.play()
    expect(t.api.setVolume).not.toHaveBeenCalled()
  })

  it('survives TIDAL rejecting a command', async () => {
    const t = setup()
    await startPlaying(t)
    t.api.seek.mockRejectedValue(new Error('no device'))
    t.api.setVolume.mockRejectedValue(new Error('no device'))
    t.api.pause.mockRejectedValue(new Error('no device'))

    expect(() => {
      t.audio.currentTime = 5
      t.audio.volume = 0.2
      t.audio.pause()
    }).not.toThrow()
    await vi.advanceTimersByTimeAsync(0)
  })
})

describe('TidalAudio reset', () => {
  it('forgets the track and unsubscribes when the source is cleared', async () => {
    const t = setup()
    await startPlaying(t)

    t.audio.removeAttribute('src')

    expect(t.audio).toMatchObject({ src: '', paused: true, currentTime: 0 })
    expect(t.unsubscribe).toHaveBeenCalledOnce()
    expect(t.hasListener()).toBe(false)
  })

  it('starts from a clean slate when given a new track', async () => {
    const t = setup()
    await startPlaying(t)

    t.audio.src = `tidal:${OTHER}`

    expect(t.audio.currentTime).toBe(0)
    expect(t.audio.duration).toBeNaN()
    expect(t.audio.paused).toBe(true)
  })

  it('load() does nothing', () => {
    const { audio } = setup()
    expect(() => audio.load()).not.toThrow()
  })
})
