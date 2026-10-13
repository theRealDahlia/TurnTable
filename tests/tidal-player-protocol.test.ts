import { describe, expect, it } from 'vitest'
import { isTidalPlayerEvent } from '../src/shared/tidalPlayer'

const state = { type: 'state', trackId: 'abc', paused: false, positionMs: 10, durationMs: 100, ended: false }

describe('isTidalPlayerEvent', () => {
  it('accepts the events of exactly the documented shapes', () => {
    expect(isTidalPlayerEvent({ type: 'ready' })).toBe(true)
    expect(isTidalPlayerEvent(state)).toBe(true)
    expect(isTidalPlayerEvent({ ...state, trackId: null })).toBe(true)
    expect(isTidalPlayerEvent({ type: 'error', kind: 'playback', message: 'No' })).toBe(true)
    for (const action of ['next', 'previous', 'toggle']) expect(isTidalPlayerEvent({ type: 'media-key', action })).toBe(true)
  })

  it.each([
    ['nothing', undefined],
    ['text', 'ready'],
    ['an unknown type', { type: 'not-ready' }],
    ['a media key that is not one of ours', { type: 'media-key', action: 'stop' }],
    ['a media key with no action', { type: 'media-key' }],
    ['a state with a missing field', { type: 'state', trackId: 'a', paused: true }],
    ['a state with a negative position', { ...state, positionMs: -1 }],
    ['a state with a position that is not a number', { ...state, positionMs: '10' }],
    ['a state with an infinite duration', { ...state, durationMs: Infinity }],
    ['a state with an id that is not text', { ...state, trackId: 7 }],
    ['an error of an unknown kind', { type: 'error', kind: 'account', message: 'x' }],
    ['an error with a very long message', { type: 'error', kind: 'playback', message: 'x'.repeat(501) }],
    ['an error with no message', { type: 'error', kind: 'playback' }]
  ])('rejects %s', (_label, value) => {
    expect(isTidalPlayerEvent(value)).toBe(false)
  })
})
