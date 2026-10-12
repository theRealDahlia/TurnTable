import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SoundCloudPlayerCommand, SoundCloudPlayerEvent, SoundCloudPlayerState } from '@shared/soundcloudPlayer'
import { errorMessageOf } from './media'
import { SOUNDCLOUD_ERRORS, SoundCloudAudio, soundcloudTrackIdFromSource } from './SoundCloudAudio'
import type { SoundCloudChannel } from './SoundCloudBridge'

const ID = '293'
const OTHER = '7'
const SRC = `soundcloud:${ID}`

class FakeChannel implements SoundCloudChannel {
  sent: SoundCloudPlayerCommand[] = []
  requested = 0
  listeners = new Set<(event: SoundCloudPlayerEvent) => void>()
  request = () => void this.requested++
  send = (command: SoundCloudPlayerCommand) => void this.sent.push(command)
  onEvent = (listener: (event: SoundCloudPlayerEvent) => void) => {
    this.listeners.add(listener)
    return () => void this.listeners.delete(listener)
  }
  emit(event: SoundCloudPlayerEvent): void {
    for (const listener of [...this.listeners]) listener(event)
  }
  state(state: SoundCloudPlayerState, fields: { trackId?: string | null; positionSeconds?: number; durationSeconds?: number } = {}): void {
    this.emit({ type: 'state', trackId: ID, positionSeconds: 0, durationSeconds: 214, state, ...fields })
  }
}

let time = 10_000
function setup(source: string | undefined = SRC) {
  const channel = new FakeChannel()
  const keeper = { start: vi.fn(), stop: vi.fn() }
  const audio = new SoundCloudAudio(channel, { now: () => time, startTimeoutMs: 5_000, keeper })
  const heard: string[] = []
  const errors: (string | undefined)[] = []
  for (const type of ['playing', 'waiting', 'pause', 'timeupdate', 'durationchange', 'ended']) audio.addEventListener(type, () => heard.push(type))
  audio.addEventListener('error', (event) => errors.push(errorMessageOf(event)))
  if (source !== undefined) audio.src = source
  return { audio, channel, heard, errors, keeper }
}

beforeEach(() => {
  time = 10_000
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('soundcloudTrackIdFromSource', () => {
  it.each([
    [SRC, ID],
    ['soundcloud:1', '1'],
    ['soundcloud:', undefined],
    ['soundcloud:abc', undefined],
    ['soundcloud:293/../me', undefined],
    ['soundcloud:tracks:293', undefined],
    ['youtube:abcdefghijk', undefined],
    ['https://soundcloud.com/forss/flickermood', undefined],
    ['', undefined]
  ])('reads %j as %j', (source, expected) => {
    expect(soundcloudTrackIdFromSource(source)).toBe(expected)
  })
})

describe('SoundCloudAudio', () => {
  it('reports the source it was given, and nothing for an invalid one', () => {
    expect(setup().audio.src).toBe(SRC)
    expect(setup('soundcloud:nope').audio.src).toBe('')
    expect(setup('youtube:abcdefghijk').audio.src).toBe('')
  })

  it('refuses to play an invalid source', async () => {
    const { audio, channel } = setup('soundcloud:nope')
    await expect(audio.play()).rejects.toThrow('not a valid SoundCloud track')
    expect(channel.sent).toEqual([])
  })

  it('asks for the player, loads the track by its number, and starts reporting once SoundCloud is playing', async () => {
    const { audio, channel, heard } = setup()

    await audio.play()
    expect(channel.requested).toBe(1)
    expect(channel.sent).toEqual([{ type: 'load', trackId: ID }])

    channel.state('playing', { positionSeconds: 2.5, durationSeconds: 214 })

    expect(heard).toEqual(['durationchange', 'playing', 'timeupdate'])
    expect(audio.duration).toBe(214)
    expect(audio.currentTime).toBe(2.5)
  })

  it('takes the length from a report made before playing starts, and does not time out', async () => {
    const { audio, channel, errors } = setup()
    await audio.play()
    channel.state('unstarted', { durationSeconds: 214 })
    vi.advanceTimersByTime(60_000)
    expect(audio.duration).toBe(214)
    expect(errors).toEqual([])
  })

  it('ignores reports about other tracks', async () => {
    const { audio, channel, heard } = setup()
    await audio.play()
    channel.state('playing', { trackId: OTHER })
    channel.state('playing', { trackId: null })
    expect(heard).toEqual([])
  })

  it('pauses, resumes without reloading, seeks and sets the volume through the player', async () => {
    const { audio, channel } = setup()
    await audio.play()
    channel.state('playing')
    channel.sent = []

    audio.pause()
    time += 5_000
    await audio.play()
    audio.currentTime = 90
    audio.volume = 0.25

    expect(channel.sent).toEqual([{ type: 'pause' }, { type: 'play' }, { type: 'seek', seconds: 90 }, { type: 'setVolume', volume: 0.25 }])
  })

  it('announces the end of the track', async () => {
    const { audio, channel, heard } = setup()
    await audio.play()
    channel.state('playing')
    heard.length = 0
    channel.state('ended', { positionSeconds: 214 })
    expect(heard).toEqual(['ended'])
    expect(audio.ended).toBe(true)
  })

  it('explains a failure of the widget, and a player that would not load', async () => {
    const failed = setup()
    await failed.audio.play()
    failed.channel.emit({ type: 'error', code: 0 })
    expect(failed.errors[0]).toMatch(/couldn't play this track in Muze/)

    const noScript = setup()
    await noScript.audio.play()
    noScript.channel.emit({ type: 'load-failed' })
    expect(noScript.errors).toEqual([SOUNDCLOUD_ERRORS.loadFailed])
  })

  it('fails with a message if SoundCloud never reports the track', async () => {
    const { audio, errors } = setup()
    await audio.play()
    vi.advanceTimersByTime(5_000)
    expect(errors).toEqual([SOUNDCLOUD_ERRORS.notStarted])
  })

  it('silences the old track when the source changes, and ignores its late reports', async () => {
    const { audio, channel, heard } = setup()
    await audio.play()
    channel.state('playing')
    channel.sent = []
    heard.length = 0

    audio.src = `soundcloud:${OTHER}`
    channel.state('playing', { positionSeconds: 50 })

    expect(channel.sent).toEqual([{ type: 'pause' }])
    expect(heard).toEqual([])
    await audio.play()
    expect(channel.sent.at(-1)).toEqual({ type: 'load', trackId: OTHER })
  })

  it('holds the app\'s media controls while it plays, so the keyboard\'s skip keys reach the app', async () => {
    const { audio, channel, keeper } = setup()
    await audio.play()
    expect(keeper.start).toHaveBeenCalled()
    channel.state('playing')
    keeper.stop.mockClear()
    audio.pause()
    expect(keeper.stop).toHaveBeenCalledOnce()
  })
})
