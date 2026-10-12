// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEGAL_VERSION } from '@shared/legal'
import { ACCEPTANCE_KEY, useAcceptance } from './useAcceptance'

beforeEach(() => window.localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('useAcceptance', () => {
  it('starts not accepted, and remembers the current version once accepted', () => {
    const { result } = renderHook(() => useAcceptance())
    expect(result.current.accepted).toBe(false)

    act(() => result.current.accept())

    expect(result.current.accepted).toBe(true)
    expect(window.localStorage.getItem(ACCEPTANCE_KEY)).toBe(LEGAL_VERSION)
    expect(renderHook(() => useAcceptance()).result.current.accepted).toBe(true)
  })

  it('asks again when the documents have a newer version than the one that was accepted', () => {
    window.localStorage.setItem(ACCEPTANCE_KEY, '2000-01-01')
    expect(renderHook(() => useAcceptance()).result.current.accepted).toBe(false)
  })

  it('works for the session even when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useAcceptance())
    expect(result.current.accepted).toBe(false)

    act(() => result.current.accept())

    expect(result.current.accepted).toBe(true)
  })
})
