import { describe, expect, it, vi } from 'vitest'
import type { YouTubePlayerCommand, YouTubePlayerEvent } from '@shared/youtubePlayer'
import { YouTubeBridge } from './YouTubeBridge'

const ORIGIN = 'http://127.0.0.1:5000'
const ID = 'abcdefghijk'
const LOAD: YouTubePlayerCommand = { type: 'load', videoId: ID }

function setup() {
  const host = new EventTarget()
  const frame = { postMessage: vi.fn() }
  const bridge = new YouTubeBridge(host)
  const heard: YouTubePlayerEvent[] = []
  bridge.onEvent((event) => heard.push(event))
  const deliver = (data: unknown, from: { source?: unknown; origin?: string } = {}) =>
    host.dispatchEvent(Object.assign(new Event('message'), { data, source: 'source' in from ? from.source : frame, origin: from.origin ?? ORIGIN }))
  return { bridge, frame, host, heard, deliver }
}

describe('YouTubeBridge frame request', () => {
  it('tells subscribers once when the frame is first asked for, and remembers it', () => {
    const { bridge } = setup()
    const changed = vi.fn()
    bridge.subscribe(changed)
    expect(bridge.isRequested()).toBe(false)

    bridge.request()
    bridge.request()

    expect(bridge.isRequested()).toBe(true)
    expect(changed).toHaveBeenCalledOnce()
  })

  it('stops telling a subscriber that unsubscribed', () => {
    const { bridge } = setup()
    const changed = vi.fn()
    bridge.subscribe(changed)()
    bridge.request()
    expect(changed).not.toHaveBeenCalled()
  })
})

describe('YouTubeBridge commands', () => {
  it('holds commands until the player says it is ready, then sends them in order to the player\'s origin', () => {
    const { bridge, frame, deliver } = setup()
    bridge.attach(frame, ORIGIN)
    bridge.send({ type: 'setVolume', volume: 0.5 })
    bridge.send({ type: 'play' })
    expect(frame.postMessage).not.toHaveBeenCalled()

    deliver({ type: 'ready' })

    expect(frame.postMessage.mock.calls).toEqual([
      [{ type: 'setVolume', volume: 0.5 }, ORIGIN],
      [{ type: 'play' }, ORIGIN]
    ])
  })

  it('sends straight away once the player is ready', () => {
    const { bridge, frame, deliver } = setup()
    bridge.attach(frame, ORIGIN)
    deliver({ type: 'ready' })
    bridge.send(LOAD)
    expect(frame.postMessage).toHaveBeenCalledExactlyOnceWith(LOAD, ORIGIN)
  })

  it('holds commands sent before any frame exists, and delivers them when it is ready', () => {
    const { bridge, frame, deliver } = setup()
    bridge.send(LOAD)
    bridge.attach(frame, ORIGIN)
    deliver({ type: 'ready' })
    expect(frame.postMessage).toHaveBeenCalledExactlyOnceWith(LOAD, ORIGIN)
  })

  it('lets a newer video replace the commands that were waiting', () => {
    const { bridge, frame, deliver } = setup()
    bridge.attach(frame, ORIGIN)
    bridge.send(LOAD)
    bridge.send({ type: 'seek', seconds: 5 })
    bridge.send({ type: 'load', videoId: 'lmnopqrstuv' })
    bridge.send({ type: 'pause' })

    deliver({ type: 'ready' })

    expect(frame.postMessage.mock.calls.map(([command]) => command)).toEqual([{ type: 'load', videoId: 'lmnopqrstuv' }, { type: 'pause' }])
  })

  it('waits for the new page to be ready when the frame is attached again', () => {
    const { bridge, frame, deliver } = setup()
    bridge.attach(frame, ORIGIN)
    deliver({ type: 'ready' })

    const reloaded = { postMessage: vi.fn() }
    bridge.attach(reloaded, ORIGIN)
    bridge.send({ type: 'play' })
    expect(reloaded.postMessage).not.toHaveBeenCalled()
  })
})

describe('YouTubeBridge events', () => {
  it('passes on well-formed events from the frame, including readiness', () => {
    const { bridge, frame, heard, deliver } = setup()
    bridge.attach(frame, ORIGIN)
    const state = { type: 'state', videoId: ID, state: 'playing', positionSeconds: 1, durationSeconds: 200 }
    deliver({ type: 'ready' })
    deliver(state)
    expect(heard).toEqual([{ type: 'ready' }, state])
  })

  it('ignores messages from any other window, any other origin, or in any other shape', () => {
    const { bridge, frame, heard, deliver } = setup()
    bridge.attach(frame, ORIGIN)

    deliver({ type: 'ready' }, { source: { postMessage: vi.fn() } })
    deliver({ type: 'ready' }, { source: null })
    deliver({ type: 'ready' }, { origin: 'https://evil.example' })
    deliver({ type: 'ready' }, { origin: 'null' })
    deliver({ type: 'error', code: 'oops' })
    deliver('ready')
    deliver(null)

    expect(heard).toEqual([])
    bridge.send({ type: 'play' })
    expect(frame.postMessage).not.toHaveBeenCalled()
  })

  it('stops listening to a frame that was detached, and does not count it as ready', () => {
    const { bridge, frame, heard, deliver } = setup()
    const detach = bridge.attach(frame, ORIGIN)
    deliver({ type: 'ready' })
    detach()

    deliver({ type: 'error', code: 150 })
    bridge.send({ type: 'play' })

    expect(heard).toEqual([{ type: 'ready' }])
    expect(frame.postMessage).not.toHaveBeenCalled()
  })

  it('does not let an old frame\'s detach disturb the frame that replaced it', () => {
    const { bridge, frame, deliver } = setup()
    const detachOld = bridge.attach(frame, ORIGIN)
    const next = { postMessage: vi.fn() }
    bridge.attach(next, ORIGIN)
    detachOld()

    deliver({ type: 'ready' }, { source: next })
    bridge.send({ type: 'play' })
    expect(next.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'play' }, ORIGIN)
  })

  it('stops telling a listener that unsubscribed', () => {
    const { bridge, frame, deliver } = setup()
    const listener = vi.fn()
    bridge.onEvent(listener)()
    bridge.attach(frame, ORIGIN)
    deliver({ type: 'ready' })
    expect(listener).not.toHaveBeenCalled()
  })
})
