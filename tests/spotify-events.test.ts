import { describe, expect, it } from 'vitest'
import { isSpotifyPlayerEvent } from '../src/shared/spotifyPlayer'

const DEVICE = 'abcdef0123456789abcdef0123456789abcdef01'

describe('isSpotifyPlayerEvent', () => {
  it.each([
    { type: 'ready', deviceId: DEVICE },
    { type: 'not-ready' },
    { type: 'state', trackId: 'abc', paused: false, positionMs: 0, durationMs: 1000, ended: false },
    { type: 'state', trackId: null, paused: true, positionMs: 12.5, durationMs: 0, ended: true },
    { type: 'error', kind: 'account', message: 'Premium required.' },
    { type: 'error', kind: 'playback', message: '' }
  ])('accepts %j', (event) => {
    expect(isSpotifyPlayerEvent(event)).toBe(true)
  })

  it.each([
    ['null', null],
    ['a string', 'ready'],
    ['an array', []],
    ['an unknown type', { type: 'exec', cmd: 'rm -rf /' }],
    ['no type', { deviceId: DEVICE }],
    ['a ready event with no device', { type: 'ready' }],
    ['a device id that could alter a URL', { type: 'ready', deviceId: 'abc/def?x=1&y=2' }],
    ['a too-short device id', { type: 'ready', deviceId: 'abc' }],
    ['a state with a string position', { type: 'state', trackId: 'a', paused: false, positionMs: '5', durationMs: 1, ended: false }],
    ['a state with a negative position', { type: 'state', trackId: 'a', paused: false, positionMs: -1, durationMs: 1, ended: false }],
    ['a state with NaN', { type: 'state', trackId: 'a', paused: false, positionMs: NaN, durationMs: 1, ended: false }],
    ['a state with Infinity', { type: 'state', trackId: 'a', paused: false, positionMs: 1, durationMs: Infinity, ended: false }],
    ['a state with a numeric track id', { type: 'state', trackId: 5, paused: false, positionMs: 1, durationMs: 1, ended: false }],
    ['a state missing fields', { type: 'state', trackId: 'a' }],
    ['an error with an unknown kind', { type: 'error', kind: 'fatal', message: 'x' }],
    ['an error with a non-string message', { type: 'error', kind: 'account', message: { a: 1 } }],
    ['an error with an oversized message', { type: 'error', kind: 'account', message: 'x'.repeat(501) }]
  ])('rejects %s', (_label, event) => {
    expect(isSpotifyPlayerEvent(event)).toBe(false)
  })
})
