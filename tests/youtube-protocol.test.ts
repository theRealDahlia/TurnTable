import { describe, expect, it } from 'vitest'
import { describeYouTubeError, isYouTubePlayerCommand, isYouTubePlayerEvent } from '../src/shared/youtubePlayer'

const ID = 'abcdefghijk'

describe('isYouTubePlayerEvent', () => {
  it.each([
    { type: 'ready' },
    { type: 'load-failed' },
    { type: 'error', code: 150 },
    { type: 'state', videoId: ID, state: 'playing', positionSeconds: 1.5, durationSeconds: 200 },
    { type: 'state', videoId: null, state: 'unstarted', positionSeconds: 0, durationSeconds: 0 }
  ])('accepts %j', (event) => {
    expect(isYouTubePlayerEvent(event)).toBe(true)
  })

  it.each([
    ['null', null],
    ['text', 'ready'],
    ['an unknown type', { type: 'hack' }],
    ['no type', {}],
    ['a fractional error code', { type: 'error', code: 1.5 }],
    ['a text error code', { type: 'error', code: '150' }],
    ['a state with a bad video id', { type: 'state', videoId: '../../x', state: 'playing', positionSeconds: 0, durationSeconds: 0 }],
    ['a state with an unknown state name', { type: 'state', videoId: ID, state: 'exploding', positionSeconds: 0, durationSeconds: 0 }],
    ['a negative position', { type: 'state', videoId: ID, state: 'playing', positionSeconds: -1, durationSeconds: 0 }],
    ['a non-finite duration', { type: 'state', videoId: ID, state: 'playing', positionSeconds: 0, durationSeconds: Infinity }],
    ['a text position', { type: 'state', videoId: ID, state: 'playing', positionSeconds: '1', durationSeconds: 0 }]
  ])('rejects %s', (_label, event) => {
    expect(isYouTubePlayerEvent(event)).toBe(false)
  })
})

describe('isYouTubePlayerCommand', () => {
  it.each([
    { type: 'load', videoId: ID },
    { type: 'play' },
    { type: 'pause' },
    { type: 'seek', seconds: 0 },
    { type: 'seek', seconds: 91.5 },
    { type: 'setVolume', volume: 0 },
    { type: 'setVolume', volume: 1 }
  ])('accepts %j', (command) => {
    expect(isYouTubePlayerCommand(command)).toBe(true)
  })

  it.each([
    ['null', null],
    ['a load without an id', { type: 'load' }],
    ['a load with a bad id', { type: 'load', videoId: 'short' }],
    ['a load with an id that could alter a URL', { type: 'load', videoId: 'abc/def?ghi' }],
    ['a negative seek', { type: 'seek', seconds: -1 }],
    ['a seek to NaN', { type: 'seek', seconds: NaN }],
    ['a volume above 1', { type: 'setVolume', volume: 2 }],
    ['a negative volume', { type: 'setVolume', volume: -0.1 }],
    ['a text volume', { type: 'setVolume', volume: '1' }],
    ['an unknown type', { type: 'eval', code: 'x' }]
  ])('rejects %s', (_label, command) => {
    expect(isYouTubePlayerCommand(command)).toBe(false)
  })
})

describe('describeYouTubeError', () => {
  it.each([101, 150])('explains that the owner blocked playing outside YouTube (%i)', (code) => {
    expect(describeYouTubeError(code)).toMatch(/owner .* outside YouTube/)
  })

  it('explains removed videos, and names unknown codes', () => {
    expect(describeYouTubeError(100)).toMatch(/removed or is private/)
    expect(describeYouTubeError(2)).toMatch(/invalid/)
    expect(describeYouTubeError(5)).toMatch(/problem/)
    expect(describeYouTubeError(153)).toMatch(/refused/)
    expect(describeYouTubeError(999)).toContain('999')
  })
})
