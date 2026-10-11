import { describe, expect, it } from 'vitest'
import { describeError, isAbortError } from '../src/shared/errors'

describe('describeError', () => {
  it.each([
    ['a plain message', new Error('Spotify request failed with status 500'), 'Spotify request failed with status 500'],
    ['an Electron IPC wrapper', new Error("Error invoking remote method 'providers:connect': NotImplementedError: Spotify sign-in is not implemented yet"), 'Spotify sign-in is not implemented yet'],
    ['an IPC wrapper around a plain Error', new Error("Error invoking remote method 'library:saved-tracks': Error: Invalid library cursor"), 'Invalid library cursor'],
    [
      'IPC errors wrapped twice across two boundaries',
      new Error(
        "Error invoking remote method 'spotify:play': Error: Error invoking remote method 'spotify-player:get-token': PlaybackPermissionError: Reconnect Spotify to allow playback in Muze."
      ),
      'Reconnect Spotify to allow playback in Muze.'
    ],
    ['a thrown string', 'just text', 'just text'],
    ['an object with a message', { message: 'from an object' }, 'from an object']
  ])('cleans %s', (_label, error, expected) => {
    expect(describeError(error)).toBe(expected)
  })

  it('keeps a colon that is part of the message itself', () => {
    expect(describeError(new Error('Spotify: Premium required (status 403)'))).toBe('Spotify: Premium required (status 403)')
  })

  it('never returns an empty string', () => {
    expect(describeError(new Error('Error: '))).toBe('Error: ')
    expect(describeError(new Error(''))).toBe('')
  })

  it('copes with values that are not errors at all', () => {
    expect(describeError(undefined)).toBe('undefined')
    expect(describeError(null)).toBe('null')
    expect(describeError(42)).toBe('42')
  })
})

describe('isAbortError', () => {
  it('recognizes an AbortError from any realm', () => {
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true)
    expect(isAbortError({ name: 'AbortError' })).toBe(true)
  })

  it.each([new Error('x'), { name: 'NotAllowedError' }, null, undefined, 'AbortError'])('rejects %j', (value) => {
    expect(isAbortError(value)).toBe(false)
  })
})
