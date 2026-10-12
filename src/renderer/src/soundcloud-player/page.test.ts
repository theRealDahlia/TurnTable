import { describe, expect, it, vi } from 'vitest'
import type { SoundCloudPlayerEvent } from '@shared/soundcloudPlayer'
import { startSoundCloudPage, type ScNamespace, type WidgetEventData, type WidgetLike } from './page'

const EVENTS = { READY: 'ready', PLAY: 'play', PAUSE: 'pause', FINISH: 'finish', PLAY_PROGRESS: 'playProgress', SEEK: 'seek', ERROR: 'error' } as const

class FakeWidget implements WidgetLike {
  listeners = new Map<string, (data?: WidgetEventData) => void>()
  play = vi.fn()
  pause = vi.fn()
  seekTo = vi.fn()
  setVolume = vi.fn()
  load = vi.fn()
  durationMs = 215_000
  getDuration = vi.fn((callback: (ms: number) => void) => callback(this.durationMs))
  bind(event: string, listener: (data?: WidgetEventData) => void): void {
    this.listeners.set(event, listener)
  }
  fire(event: keyof typeof EVENTS, data?: WidgetEventData): void {
    this.listeners.get(EVENTS[event])?.(data)
  }
}

function setup() {
  let widget!: FakeWidget
  const sc = {
    Widget: Object.assign(
      (frame: HTMLIFrameElement) => {
        widget = new FakeWidget()
        created.push(frame)
        return widget
      },
      { Events: EVENTS }
    )
  } as unknown as ScNamespace
  const created: HTMLIFrameElement[] = []
  const frame = { src: '' } as HTMLIFrameElement
  const events: SoundCloudPlayerEvent[] = []
  const handle = startSoundCloudPage(sc, { frame, post: (event) => events.push(event) })
  return { handle, frame, events, created, get widget() { return widget } }
}

const state = (events: SoundCloudPlayerEvent[]) => events.filter((e) => e.type === 'state').at(-1)
const ID = '293'

describe('SoundCloud player page', () => {
  it('tells the app it is ready before anything is loaded, without touching the widget', () => {
    const { events, created } = setup()
    expect(events).toEqual([{ type: 'ready' }])
    expect(created).toHaveLength(0)
  })

  it('shows the widget for the first track and starts listening to it', () => {
    const t = setup()
    expect(t.handle({ type: 'load', trackId: ID })).toBe(true)

    expect(t.frame.src).toBe(
      'https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F293&auto_play=true&visual=true&show_comments=false&show_teaser=false&hide_related=true&buying=false&sharing=false&download=false&liking=false'
    )
    expect(t.created).toEqual([t.frame])
    expect([...t.widget.listeners.keys()].sort()).toEqual(Object.values(EVENTS).sort())
  })

  it('loads later tracks into the same widget, asking to play, with the same plain look', () => {
    const t = setup()
    t.handle({ type: 'load', trackId: ID })
    const first = t.widget
    t.handle({ type: 'load', trackId: '7' })

    expect(t.created).toHaveLength(1)
    expect(t.widget).toBe(first)
    expect(first.load).toHaveBeenCalledWith('https://api.soundcloud.com/tracks/7', expect.objectContaining({ auto_play: true, visual: true, show_comments: false, liking: false, sharing: false }))
  })

  it('learns the length when the widget is ready, and reports it with the track', () => {
    const t = setup()
    t.handle({ type: 'load', trackId: ID })
    t.widget.fire('READY')
    expect(state(t.events)).toEqual({ type: 'state', trackId: ID, state: 'unstarted', positionSeconds: 0, durationSeconds: 215 })
  })

  it('learns the length again for each track loaded afterwards', () => {
    const t = setup()
    t.handle({ type: 'load', trackId: ID })
    t.widget.fire('READY')
    t.widget.durationMs = 90_000
    t.handle({ type: 'load', trackId: '7' })
    const callback = (t.widget.load.mock.calls[0]![1] as { callback: () => void }).callback
    callback()
    expect(state(t.events)).toMatchObject({ trackId: '7', durationSeconds: 90 })
  })

  it('reports playing with the position, in seconds, from play and progress events', () => {
    const t = setup()
    t.handle({ type: 'load', trackId: ID })
    t.widget.fire('READY')
    t.widget.fire('PLAY', { soundId: 293, currentPosition: 0 })
    expect(state(t.events)).toMatchObject({ state: 'playing', positionSeconds: 0, durationSeconds: 215 })
    t.widget.fire('PLAY_PROGRESS', { soundId: 293, currentPosition: 12_500 })
    expect(state(t.events)).toMatchObject({ state: 'playing', positionSeconds: 12.5 })
  })

  it('reports pausing and finishing', () => {
    const t = setup()
    t.handle({ type: 'load', trackId: ID })
    t.widget.fire('PLAY', { soundId: 293, currentPosition: 1000 })
    t.widget.fire('PAUSE', { soundId: 293, currentPosition: 2000 })
    expect(state(t.events)).toMatchObject({ state: 'paused', positionSeconds: 2 })
    t.widget.fire('FINISH', { soundId: 293, currentPosition: 215_000 })
    expect(state(t.events)).toMatchObject({ state: 'ended', positionSeconds: 215 })
  })

  it('keeps a finished track finished when the widget pauses itself afterwards', () => {
    const t = setup()
    t.handle({ type: 'load', trackId: ID })
    t.widget.fire('FINISH', { soundId: 293, currentPosition: 215_000 })
    t.widget.fire('PAUSE', { soundId: 293, currentPosition: 215_000 })
    expect(state(t.events)).toMatchObject({ state: 'ended' })
  })

  it('reports the new position after a seek, in whatever state the track is in', () => {
    const t = setup()
    t.handle({ type: 'load', trackId: ID })
    t.widget.fire('PAUSE', { soundId: 293, currentPosition: 1000 })
    t.widget.fire('SEEK', { soundId: 293, currentPosition: 60_000 })
    expect(state(t.events)).toMatchObject({ state: 'paused', positionSeconds: 60 })
  })

  it('ignores what the widget says about a track other than the one asked for', () => {
    const t = setup()
    t.handle({ type: 'load', trackId: ID })
    t.widget.fire('READY')
    const before = t.events.length

    t.widget.fire('PLAY', { soundId: 999, currentPosition: 5000 })
    t.widget.fire('FINISH', { soundId: 999 })
    t.widget.fire('PLAY_PROGRESS', { soundId: undefined })
    t.widget.fire('PAUSE')

    expect(t.events).toHaveLength(before)
  })

  it('moves on to the new track\'s reports once one has been loaded', () => {
    const t = setup()
    t.handle({ type: 'load', trackId: ID })
    t.handle({ type: 'load', trackId: '7' })
    t.widget.fire('PLAY', { soundId: 293, currentPosition: 100 })
    expect(state(t.events)).not.toMatchObject({ state: 'playing' })
    t.widget.fire('PLAY', { soundId: 7, currentPosition: 100 })
    expect(state(t.events)).toMatchObject({ trackId: '7', state: 'playing' })
  })

  it('passes on an error from the widget', () => {
    const t = setup()
    t.handle({ type: 'load', trackId: ID })
    t.widget.fire('ERROR')
    expect(t.events.at(-1)).toEqual({ type: 'error', code: 0 })
  })

  it('cleans up positions that make no sense', () => {
    const t = setup()
    t.handle({ type: 'load', trackId: ID })
    t.widget.fire('PLAY', { soundId: 293, currentPosition: NaN })
    expect(state(t.events)).toMatchObject({ positionSeconds: 0 })
    t.widget.fire('PLAY', { soundId: 293, currentPosition: -50 })
    expect(state(t.events)).toMatchObject({ positionSeconds: 0 })
    t.widget.durationMs = NaN
    t.widget.fire('READY')
    expect(state(t.events)).toMatchObject({ durationSeconds: 0 })
  })

  describe('commands', () => {
    it('plays, pauses, seeks and sets the volume on the widget', () => {
      const t = setup()
      t.handle({ type: 'load', trackId: ID })
      expect(t.handle({ type: 'play' })).toBe(true)
      t.handle({ type: 'pause' })
      t.handle({ type: 'seek', seconds: 42.5 })
      t.handle({ type: 'setVolume', volume: 0.3 })
      t.handle({ type: 'setVolume', volume: 1 })
      expect(t.widget.play).toHaveBeenCalledOnce()
      expect(t.widget.pause).toHaveBeenCalledOnce()
      expect(t.widget.seekTo).toHaveBeenCalledExactlyOnceWith(42_500)
      expect(t.widget.setVolume.mock.calls).toEqual([[30], [100]])
    })

    it('is fine being told things before any track is loaded', () => {
      const t = setup()
      for (const command of [{ type: 'play' }, { type: 'pause' }, { type: 'seek', seconds: 5 }, { type: 'setVolume', volume: 0.5 }]) {
        expect(t.handle(command)).toBe(true)
      }
      expect(t.created).toHaveLength(0)
    })

    it.each([[null], ['play'], [{ type: 'load', trackId: '../x' }], [{ type: 'load', trackId: '12a' }], [{ type: 'load' }], [{ type: 'seek', seconds: -1 }], [{ type: 'setVolume', volume: 2 }], [{ type: 'unknown' }]])('ignores %j', (command) => {
      const t = setup()
      expect(t.handle(command)).toBe(false)
      expect(t.created).toHaveLength(0)
      expect(t.frame.src).toBe('')
    })
  })
})
