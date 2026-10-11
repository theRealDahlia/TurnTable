import { describe, expect, it, vi } from 'vitest'
import type { YouTubePlayerEvent } from '@shared/youtubePlayer'
import { startYouTubePage, type YtNamespace, type YtPlayer } from './page'

class FakePlayer implements YtPlayer {
  loadVideoById = vi.fn()
  playVideo = vi.fn()
  pauseVideo = vi.fn()
  seekTo = vi.fn()
  setVolume = vi.fn()
  playerState = -1
  time = 0
  length = 0
  videoId: string | undefined
  getCurrentTime = () => this.time
  getDuration = () => this.length
  getPlayerState = () => this.playerState
  getVideoData = () => ({ video_id: this.videoId })
  constructor(
    readonly element: unknown,
    readonly options: { playerVars: Record<string, string | number>; width: string; height: string; events: { onReady: () => void; onStateChange: (e: { data: number }) => void; onError: (e: { data: number }) => void } }
  ) {}
}

function setup() {
  let player!: FakePlayer
  const yt = {
    Player: function (element: unknown, options: FakePlayer['options']) {
      player = new FakePlayer(element, options)
      return player
    }
  } as unknown as YtNamespace
  const events: YouTubePlayerEvent[] = []
  const timers = new Map<number, () => void>()
  let nextTimer = 1
  const handle = startYouTubePage(yt, {
    element: 'player',
    origin: 'http://127.0.0.1:9',
    post: (event) => events.push(event),
    setInterval: (callback) => {
      timers.set(nextTimer, callback)
      return nextTimer++
    },
    clearInterval: (id) => void timers.delete(id as number)
  })
  const last = () => events.at(-1)
  const change = (state: number, fields: Partial<Pick<FakePlayer, 'time' | 'length' | 'videoId'>> = {}) => {
    Object.assign(player, fields)
    player.playerState = state
    player.options.events.onStateChange({ data: state })
  }
  return { player, handle, events, timers, last, change, get p() { return player } }
}

describe('YouTube player page', () => {
  it('creates a full-size player that is told this page\'s origin', () => {
    const { p } = setup()
    expect(p.element).toBe('player')
    expect(p.options.width).toBe('100%')
    expect(p.options.height).toBe('100%')
    expect(p.options.playerVars).toMatchObject({ enablejsapi: 1, origin: 'http://127.0.0.1:9', playsinline: 1 })
  })

  it('tells the app when the player is ready, and when YouTube reports an error', () => {
    const { p, events } = setup()
    p.options.events.onReady()
    p.options.events.onError({ data: 150 })
    expect(events).toEqual([{ type: 'ready' }, { type: 'error', code: 150 }])
  })

  it('reports state changes with position and length', () => {
    const { change, last } = setup()
    change(1, { time: 12.5, length: 215, videoId: 'abcdefghijk' })
    expect(last()).toEqual({ type: 'state', videoId: 'abcdefghijk', state: 'playing', positionSeconds: 12.5, durationSeconds: 215 })
    change(2)
    expect(last()).toMatchObject({ state: 'paused' })
    change(0)
    expect(last()).toMatchObject({ state: 'ended' })
    change(3)
    expect(last()).toMatchObject({ state: 'buffering' })
    change(5)
    expect(last()).toMatchObject({ state: 'cued' })
    change(-1)
    expect(last()).toMatchObject({ state: 'unstarted' })
  })

  it('ignores state numbers it does not know', () => {
    const { change, events } = setup()
    change(42)
    expect(events).toEqual([])
  })

  it('cleans up odd numbers and ids from the player', () => {
    const { change, last } = setup()
    change(1, { time: NaN, length: Infinity, videoId: 'short' })
    expect(last()).toMatchObject({ videoId: null, positionSeconds: 0, durationSeconds: 0 })
    change(1, { time: -3, length: -1, videoId: undefined })
    expect(last()).toMatchObject({ videoId: null, positionSeconds: 0, durationSeconds: 0 })
  })

  it('reports the position regularly while playing, and stops when paused', () => {
    const { change, timers, events, p } = setup()
    change(1, { time: 1, length: 100, videoId: 'abcdefghijk' })
    expect(timers.size).toBe(1)
    change(1, { time: 1.2 })
    expect(timers.size).toBe(1)

    const before = events.length
    p.time = 3
    for (const tick of timers.values()) tick()
    expect(events.length).toBe(before + 1)
    expect(events.at(-1)).toMatchObject({ positionSeconds: 3 })

    change(2)
    expect(timers.size).toBe(0)
  })

  it('also keeps reporting while buffering', () => {
    const { change, timers } = setup()
    change(3)
    expect(timers.size).toBe(1)
  })

  describe('commands', () => {
    it('loads a video, plays, pauses and seeks', () => {
      const { handle, p } = setup()
      expect(handle({ type: 'load', videoId: 'abcdefghijk' })).toBe(true)
      expect(p.loadVideoById).toHaveBeenCalledWith('abcdefghijk')
      handle({ type: 'play' })
      handle({ type: 'pause' })
      handle({ type: 'seek', seconds: 42 })
      expect(p.playVideo).toHaveBeenCalledOnce()
      expect(p.pauseVideo).toHaveBeenCalledOnce()
      expect(p.seekTo).toHaveBeenCalledWith(42, true)
    })

    it('reports the new position right after a seek', () => {
      const { handle, p, events } = setup()
      p.playerState = 2
      p.time = 42
      handle({ type: 'seek', seconds: 42 })
      expect(events.at(-1)).toMatchObject({ type: 'state', state: 'paused', positionSeconds: 42 })
    })

    it('sets the volume on YouTube\'s 0 to 100 scale', () => {
      const { handle, p } = setup()
      handle({ type: 'setVolume', volume: 0.5 })
      handle({ type: 'setVolume', volume: 1 })
      handle({ type: 'setVolume', volume: 0 })
      expect(p.setVolume.mock.calls).toEqual([[50], [100], [0]])
    })

    it.each([[null], ['play'], [{ type: 'load', videoId: '../x' }], [{ type: 'seek', seconds: -1 }], [{ type: 'unknown' }]])('ignores %j', (command) => {
      const { handle, p } = setup()
      expect(handle(command)).toBe(false)
      expect(p.loadVideoById).not.toHaveBeenCalled()
      expect(p.playVideo).not.toHaveBeenCalled()
      expect(p.seekTo).not.toHaveBeenCalled()
    })
  })
})
