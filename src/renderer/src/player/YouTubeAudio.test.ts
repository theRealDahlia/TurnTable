import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { YouTubePlayerCommand, YouTubePlayerEvent, YouTubePlayerState } from '@shared/youtubePlayer'
import { errorMessageOf } from './media'
import { YOUTUBE_ERRORS, YouTubeAudio, youtubeVideoIdFromSource } from './YouTubeAudio'
import type { YouTubeChannel } from './YouTubeBridge'

const ID = 'abcdefghijk'
const OTHER = 'lmnopqrstuv'
const SRC = `youtube:${ID}`

class FakeChannel implements YouTubeChannel {
  sent: YouTubePlayerCommand[] = []
  requested = 0
  listeners = new Set<(event: YouTubePlayerEvent) => void>()
  request = () => void this.requested++
  send = (command: YouTubePlayerCommand) => void this.sent.push(command)
  onEvent = (listener: (event: YouTubePlayerEvent) => void) => {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }
  emit(event: YouTubePlayerEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }
  state(state: YouTubePlayerState, fields: { videoId?: string | null; positionSeconds?: number; durationSeconds?: number } = {}): void {
    this.emit({ type: 'state', videoId: ID, positionSeconds: 0, durationSeconds: 200, state, ...fields })
  }
  get commands(): string[] {
    return this.sent.map((command) => command.type)
  }
}

let time = 10_000
function setup(source: string | undefined = SRC) {
  const channel = new FakeChannel()
  const audio = new YouTubeAudio(channel, { now: () => time, startTimeoutMs: 5_000 })
  const heard: string[] = []
  const errors: (string | undefined)[] = []
  for (const type of ['playing', 'waiting', 'pause', 'timeupdate', 'durationchange', 'ended']) audio.addEventListener(type, () => heard.push(type))
  audio.addEventListener('error', (event) => errors.push(errorMessageOf(event)))
  if (source !== undefined) audio.src = source
  return { audio, channel, heard, errors }
}

beforeEach(() => {
  time = 10_000
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('youtubeVideoIdFromSource', () => {
  it.each([
    [SRC, ID],
    ['youtube:abc', undefined],
    ['youtube:abcdefghijk/extra', undefined],
    ['youtube:../../x', undefined],
    ['spotify:track:abcdefghijk', undefined],
    [`https://www.youtube.com/watch?v=${ID}`, undefined],
    ['', undefined]
  ])('reads %j as %j', (source, expected) => {
    expect(youtubeVideoIdFromSource(source)).toBe(expected)
  })
})

describe('YouTubeAudio source', () => {
  it('reports the source it was given, and nothing for an invalid one', () => {
    expect(setup().audio.src).toBe(SRC)
    expect(setup('youtube:nope').audio.src).toBe('')
  })

  it('refuses to play an invalid source', async () => {
    const { audio, channel } = setup('youtube:nope')
    await expect(audio.play()).rejects.toThrow('not a valid YouTube video')
    expect(channel.sent).toEqual([])
  })
})

describe('YouTubeAudio starting', () => {
  it('asks for the frame, loads the video, and starts reporting once YouTube says it is playing', async () => {
    const { audio, channel, heard } = setup()

    await audio.play()
    expect(channel.requested).toBe(1)
    expect(channel.sent).toEqual([{ type: 'load', videoId: ID }])
    expect(audio.paused).toBe(false)
    expect(heard).toEqual([])

    channel.state('playing', { positionSeconds: 1.5, durationSeconds: 215 })

    expect(heard).toEqual(['durationchange', 'playing', 'timeupdate'])
    expect(audio.duration).toBe(215)
    expect(audio.currentTime).toBe(1.5)
  })

  it('sets a volume chosen before it started, right after loading', async () => {
    const { audio, channel } = setup()
    audio.volume = 0.4
    expect(channel.sent).toEqual([])

    await audio.play()

    expect(channel.sent).toEqual([{ type: 'load', videoId: ID }, { type: 'setVolume', volume: 0.4 }])
  })

  it('does not announce the same duration or the playing state twice', async () => {
    const { audio, channel, heard } = setup()
    await audio.play()
    channel.state('playing', { positionSeconds: 1 })
    channel.state('playing', { positionSeconds: 2 })
    expect(heard).toEqual(['durationchange', 'playing', 'timeupdate', 'timeupdate'])
    expect(audio.currentTime).toBe(2)
  })

  it('ignores reports about other videos, and videos with no id', async () => {
    const { audio, channel, heard } = setup()
    await audio.play()

    channel.state('playing', { videoId: OTHER })
    channel.state('playing', { videoId: null })

    expect(heard).toEqual([])
    expect(audio.paused).toBe(false)
    expect(audio.currentTime).toBe(0)
  })

  it('ignores the buffering and idle states before playback has begun', async () => {
    const { audio, channel, heard } = setup()
    await audio.play()
    for (const state of ['unstarted', 'buffering', 'cued', 'paused'] as const) channel.state(state)
    // The length is learned, but nothing is announced as playing or paused.
    expect(heard).not.toContain('playing')
    expect(heard).not.toContain('pause')
    expect(heard).not.toContain('waiting')
    expect(heard.filter((type) => type === 'durationchange')).toHaveLength(1)
  })

  it('fails with a message if YouTube never reports the video', async () => {
    const { audio, errors } = setup()
    await audio.play()

    vi.advanceTimersByTime(5_000)

    expect(errors).toEqual([YOUTUBE_ERRORS.notStarted])
    expect(audio.paused).toBe(true)
  })

  it('does not time out once YouTube has reported the video', async () => {
    const { audio, channel, errors } = setup()
    await audio.play()
    channel.state('buffering')
    vi.advanceTimersByTime(60_000)
    expect(errors).toEqual([])
  })

  it('can start again after a failure', async () => {
    const { audio, channel, errors } = setup()
    await audio.play()
    vi.advanceTimersByTime(5_000)
    expect(errors).toHaveLength(1)

    channel.sent = []
    await audio.play()
    expect(channel.sent).toEqual([{ type: 'load', videoId: ID }])
  })
})

describe('YouTubeAudio errors', () => {
  it.each([
    [150, /owner .* outside YouTube/],
    [101, /owner .* outside YouTube/],
    [100, /removed or is private/]
  ])('explains YouTube error %i to the user', async (code, message) => {
    const { audio, channel, errors } = setup()
    await audio.play()

    channel.emit({ type: 'error', code })

    expect(errors[0]).toMatch(message)
    expect(audio.paused).toBe(true)
  })

  it('explains a player that could not load', async () => {
    const { audio, channel, errors } = setup()
    await audio.play()
    channel.emit({ type: 'load-failed' })
    expect(errors).toEqual([YOUTUBE_ERRORS.loadFailed])
  })

  it('reports an error only once, and not after the video was replaced', async () => {
    const { audio, channel, errors } = setup()
    await audio.play()
    channel.emit({ type: 'error', code: 150 })
    channel.emit({ type: 'error', code: 150 })
    expect(errors).toHaveLength(1)

    audio.src = `youtube:${OTHER}`
    channel.emit({ type: 'error', code: 150 })
    expect(errors).toHaveLength(1)
  })

  it('stays quiet about events when nothing was started', () => {
    const { channel, errors, heard } = setup()
    channel.emit({ type: 'error', code: 150 })
    channel.state('playing')
    expect(errors).toEqual([])
    expect(heard).toEqual([])
  })
})

describe('YouTubeAudio transport', () => {
  async function playing() {
    const ctx = setup()
    await ctx.audio.play()
    ctx.channel.state('playing', { positionSeconds: 3 })
    ctx.heard.length = 0
    ctx.channel.sent = []
    return ctx
  }

  it('pauses, tells YouTube, and announces it once', async () => {
    const { audio, channel, heard } = await playing()
    audio.pause()
    audio.pause()
    expect(channel.sent).toEqual([{ type: 'pause' }])
    expect(heard).toEqual(['pause'])
    expect(audio.paused).toBe(true)
  })

  it('resumes through the same video without reloading it', async () => {
    const { audio, channel, heard } = await playing()
    audio.pause()
    channel.sent = []
    time += 1_000

    await audio.play()
    channel.state('playing', { positionSeconds: 3 })

    expect(channel.sent).toEqual([{ type: 'play' }])
    expect(heard).toContain('playing')
    expect(audio.paused).toBe(false)
  })

  it('shows a pause that YouTube reports on its own, such as a click in the video', async () => {
    const { audio, channel, heard } = await playing()
    time += 5_000
    channel.state('paused', { positionSeconds: 4 })
    expect(heard).toEqual(['pause', 'timeupdate'])
    expect(audio.paused).toBe(true)

    channel.state('playing', { positionSeconds: 4 })
    expect(heard).toEqual(['pause', 'timeupdate', 'playing', 'timeupdate'])
  })

  it('does not let a report that was already in flight undo a pause just asked for', async () => {
    const { audio, channel, heard } = await playing()
    audio.pause()
    heard.length = 0

    channel.state('playing', { positionSeconds: 3.5 })

    expect(heard).toEqual([])
    expect(audio.paused).toBe(true)
  })

  it('does not let a stale paused report undo a resume just asked for', async () => {
    const { audio, channel, heard } = await playing()
    audio.pause()
    time += 5_000
    await audio.play()
    heard.length = 0

    channel.state('paused')

    expect(heard).toEqual([])
    expect(audio.paused).toBe(false)
  })

  it('shows buffering mid-song and then playing again', async () => {
    const { channel, heard } = await playing()
    channel.state('buffering', { positionSeconds: 10 })
    channel.state('playing', { positionSeconds: 10 })
    expect(heard).toEqual(['waiting', 'playing', 'timeupdate'])
  })

  it('passes seeks and volume to YouTube while a video is loaded', async () => {
    const { audio, channel } = await playing()
    audio.currentTime = 90
    audio.volume = 0.25
    expect(channel.sent).toEqual([{ type: 'seek', seconds: 90 }, { type: 'setVolume', volume: 0.25 }])
    expect(audio.currentTime).toBe(90)
    expect(audio.volume).toBe(0.25)
  })

  it('does not send seeks or volume when nothing is loaded', () => {
    const { audio, channel } = setup()
    audio.currentTime = 10
    audio.volume = 0.5
    expect(channel.sent).toEqual([])
  })

  it('announces the end of the video, and can play it again', async () => {
    const { audio, channel, heard } = await playing()
    channel.state('ended', { positionSeconds: 200 })
    expect(heard).toEqual(['ended'])
    expect(audio.ended).toBe(true)
    expect(audio.paused).toBe(true)

    channel.sent = []
    await audio.play()
    expect(channel.sent).toEqual([{ type: 'play' }])
    expect(audio.ended).toBe(false)
  })

  it('does not treat an end reported before it ever played as the song finishing', async () => {
    const { audio, channel, heard } = setup()
    await audio.play()
    channel.state('ended')
    expect(heard).not.toContain('ended')
    expect(audio.ended).toBe(false)
  })
})

describe('YouTubeAudio pausing during the start', () => {
  it('pauses a video that YouTube starts after the user already paused', async () => {
    const { audio, channel, heard } = setup()
    await audio.play()
    audio.pause()
    channel.sent = []
    heard.length = 0

    time += 5_000
    channel.state('playing', { positionSeconds: 0.1 })

    expect(channel.sent).toEqual([{ type: 'pause' }])
    expect(heard).toEqual(['durationchange'])
    expect(audio.paused).toBe(true)
  })

  it('plays normally if the user pressed play again', async () => {
    const { audio, channel, heard } = setup()
    await audio.play()
    audio.pause()
    await audio.play()
    channel.sent = []
    time += 5_000

    channel.state('playing')

    expect(channel.sent).toEqual([])
    expect(heard).toContain('playing')
  })
})

describe('YouTubeAudio changing video', () => {
  it('silences the old video, forgets it, and ignores its late reports', async () => {
    const { audio, channel, heard } = setup()
    await audio.play()
    channel.state('playing')
    channel.sent = []
    heard.length = 0

    audio.src = `youtube:${OTHER}`

    expect(channel.sent).toEqual([{ type: 'pause' }])
    expect(audio.src).toBe(`youtube:${OTHER}`)
    expect([audio.currentTime, audio.duration, audio.paused, audio.ended]).toEqual([0, Number.NaN, true, false])
    channel.state('playing', { positionSeconds: 50 })
    expect(heard).toEqual([])
  })

  it('loads the next video fresh', async () => {
    const { audio, channel } = setup()
    await audio.play()
    channel.state('playing')
    channel.sent = []

    audio.src = `youtube:${OTHER}`
    await audio.play()

    expect(channel.sent).toEqual([{ type: 'pause' }, { type: 'load', videoId: OTHER }])
  })

  it('stops listening to the player when the source is cleared, without commanding a video that never started', async () => {
    const { audio, channel } = setup()
    audio.removeAttribute('src')
    expect(channel.sent).toEqual([])

    audio.src = SRC
    await audio.play()
    audio.removeAttribute('src')
    expect(channel.listeners.size).toBe(0)
    expect(audio.src).toBe('')
  })

  it('does not time out after the source changed', async () => {
    const { audio, errors } = setup()
    await audio.play()
    audio.src = `youtube:${OTHER}`
    vi.advanceTimersByTime(60_000)
    expect(errors).toEqual([])
  })
})
