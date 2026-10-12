import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OAuthSession } from '../src/main/auth/session'
import { createSpotifyProvider } from '../src/main/providers/spotify/provider'

const page = (next: boolean): Response =>
  new Response(JSON.stringify({ items: [{ added_at: '2026-01-01T00:00:00Z', track: { id: 'a'.repeat(22), name: 'S', duration_ms: 1, artists: [] } }], next: next ? 'more' : null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

/** Uses the real timers and clock, which the tests above replace with ones they control. */
function setup(minIntervalMs: number | undefined, responses: Response[]) {
  const sent: number[] = []
  const session = { getAccessToken: vi.fn().mockResolvedValue('t'), disconnect: vi.fn(), isConnected: vi.fn(), connect: vi.fn() }
  const fetchFn = vi.fn(async () => {
    sent.push(Date.now())
    return responses.shift() ?? page(false)
  })
  const provider = createSpotifyProvider(session as unknown as OAuthSession, { fetch: fetchFn as unknown as typeof fetch, minIntervalMs })
  return { provider, sent }
}

describe('Spotify request pacing', () => {
  it('sends requests at least the interval apart when they follow one another', async () => {
    const { provider, sent } = setup(500, [page(true), page(true), page(false)])

    const done = (async () => {
      let cursor: string | undefined
      do cursor = (await provider.getSavedTracks(cursor)).nextCursor
      while (cursor)
    })()
    await vi.runAllTimersAsync()
    await done

    expect(sent).toHaveLength(3)
    expect(sent[1]! - sent[0]!).toBeGreaterThanOrEqual(500)
    expect(sent[2]! - sent[1]!).toBeGreaterThanOrEqual(500)
  })

  it('queues requests asked for at the same moment, one interval apart each', async () => {
    const { provider, sent } = setup(500, [])

    const all = Promise.all([provider.getSavedTracks(), provider.getSavedTracks(), provider.getSavedTracks()])
    await vi.runAllTimersAsync()
    await all

    expect(sent.map((time) => time - sent[0]!)).toEqual([0, 500, 1000])
  })

  it('does not wait when enough time has passed anyway', async () => {
    const { provider, sent } = setup(500, [])
    await provider.getSavedTracks()
    await vi.advanceTimersByTimeAsync(2000)

    await provider.getSavedTracks()

    expect(sent[1]! - sent[0]!).toBe(2000)
  })

  it('does not delay the first request, or any when spacing is off', async () => {
    const paced = setup(500, [])
    await paced.provider.getSavedTracks()
    expect(paced.sent).toHaveLength(1)

    const unpaced = setup(undefined, [page(true), page(false)])
    await unpaced.provider.getSavedTracks()
    await unpaced.provider.getSavedTracks('1')
    expect(unpaced.sent[1]).toBe(unpaced.sent[0])
  })
})
