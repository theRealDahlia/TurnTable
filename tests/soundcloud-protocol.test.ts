import { describe, expect, it } from 'vitest'
import { describeSoundCloudError, isSoundCloudPlayerCommand, isSoundCloudPlayerEvent, soundcloudWidgetUrl } from '../src/shared/soundcloudPlayer'

describe('isSoundCloudPlayerEvent', () => {
  it.each([
    { type: 'ready' },
    { type: 'load-failed' },
    { type: 'error', code: 0 },
    { type: 'state', trackId: '293', state: 'playing', positionSeconds: 1.5, durationSeconds: 200 },
    { type: 'state', trackId: null, state: 'unstarted', positionSeconds: 0, durationSeconds: 0 }
  ])('accepts %j', (event) => {
    expect(isSoundCloudPlayerEvent(event)).toBe(true)
  })

  it.each([
    ['null', null],
    ['text', 'ready'],
    ['an unknown type', { type: 'hack' }],
    ['an error with a text code', { type: 'error', code: '0' }],
    ['a state with a bad track id', { type: 'state', trackId: '../../x', state: 'playing', positionSeconds: 0, durationSeconds: 0 }],
    ['a state with a numeric track id', { type: 'state', trackId: 293, state: 'playing', positionSeconds: 0, durationSeconds: 0 }],
    ['a state with an unknown name', { type: 'state', trackId: '1', state: 'exploding', positionSeconds: 0, durationSeconds: 0 }],
    ['a negative position', { type: 'state', trackId: '1', state: 'playing', positionSeconds: -1, durationSeconds: 0 }],
    ['an infinite length', { type: 'state', trackId: '1', state: 'playing', positionSeconds: 0, durationSeconds: Infinity }]
  ])('rejects %s', (_label, event) => {
    expect(isSoundCloudPlayerEvent(event)).toBe(false)
  })
})

describe('isSoundCloudPlayerCommand', () => {
  it.each([{ type: 'load', trackId: '293' }, { type: 'play' }, { type: 'pause' }, { type: 'seek', seconds: 0 }, { type: 'seek', seconds: 91.5 }, { type: 'setVolume', volume: 0 }, { type: 'setVolume', volume: 1 }])(
    'accepts %j',
    (command) => {
      expect(isSoundCloudPlayerCommand(command)).toBe(true)
    }
  )

  it.each([
    ['null', null],
    ['a load without an id', { type: 'load' }],
    ['a load with a number', { type: 'load', trackId: 293 }],
    ['a load with something that could alter a URL', { type: 'load', trackId: '293/../me' }],
    ['a load with a URN instead of the number', { type: 'load', trackId: 'soundcloud:tracks:293' }],
    ['a negative seek', { type: 'seek', seconds: -1 }],
    ['a seek to NaN', { type: 'seek', seconds: NaN }],
    ['a volume above 1', { type: 'setVolume', volume: 2 }],
    ['an unknown type', { type: 'eval' }]
  ])('rejects %s', (_label, command) => {
    expect(isSoundCloudPlayerCommand(command)).toBe(false)
  })
})

describe('soundcloudWidgetUrl', () => {
  it('points at the widget for the track, with auto play and nothing but the player', () => {
    const url = new URL(soundcloudWidgetUrl('293'))
    expect(`${url.origin}${url.pathname}`).toBe('https://w.soundcloud.com/player/')
    expect(url.searchParams.get('url')).toBe('https://api.soundcloud.com/tracks/293')
    expect(url.searchParams.get('auto_play')).toBe('true')
    for (const off of ['show_comments', 'buying', 'sharing', 'download', 'liking', 'show_teaser']) expect(url.searchParams.get(off)).toBe('false')
  })
})

describe('describeSoundCloudError', () => {
  it('names the app and suggests the uploader may not allow it', () => {
    expect(describeSoundCloudError(0)).toMatch(/couldn't play this track in Muze/)
    expect(describeSoundCloudError(0)).toMatch(/uploader/)
  })
})
