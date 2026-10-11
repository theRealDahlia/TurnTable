import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { createApi } from '../src/main/ipc/register'
import { shareInFlight } from '../src/main/ipc/singleFlight'
import { ProviderRegistry } from '../src/main/providers/registry'
import type { MusicProvider } from '../src/main/providers/types'
import { SPOTIFY } from '../src/main/providers/descriptors'
import type { TrackPage } from '../src/shared/types'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('shareInFlight', () => {
  it('gives concurrent callers of the same key one shared request', async () => {
    const inFlight = new Map<string, Promise<number>>()
    const gate = deferred<number>()
    const start = vi.fn(() => gate.promise)

    const a = shareInFlight(inFlight, 'k', start)
    const b = shareInFlight(inFlight, 'k', start)
    gate.resolve(7)

    expect(await Promise.all([a, b])).toEqual([7, 7])
    expect(start).toHaveBeenCalledOnce()
  })

  it('keeps different keys apart', async () => {
    const inFlight = new Map<string, Promise<string>>()
    const start = vi.fn(async () => 'x')
    await Promise.all([shareInFlight(inFlight, 'a', start), shareInFlight(inFlight, 'b', start)])
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('remembers nothing once a request has finished', async () => {
    const inFlight = new Map<string, Promise<number>>()
    const start = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)

    expect(await shareInFlight(inFlight, 'k', start)).toBe(1)
    expect(inFlight.size).toBe(0)
    expect(await shareInFlight(inFlight, 'k', start)).toBe(2)
  })

  it('shares a failure with everyone waiting, then tries afresh next time', async () => {
    const inFlight = new Map<string, Promise<number>>()
    const gate = deferred<number>()
    const start = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValueOnce(5)

    const a = shareInFlight(inFlight, 'k', start)
    const b = shareInFlight(inFlight, 'k', start)
    const results = Promise.allSettled([a, b])
    gate.reject(new Error('boom'))

    expect((await results).map((r) => r.status)).toEqual(['rejected', 'rejected'])
    expect(inFlight.size).toBe(0)
    expect(await shareInFlight(inFlight, 'k', start)).toBe(5)
  })

  it('turns a synchronous throw into a rejection and does not get stuck', async () => {
    const inFlight = new Map<string, Promise<number>>()
    await expect(shareInFlight(inFlight, 'k', () => { throw new Error('sync') })).rejects.toThrow('sync')
    expect(inFlight.size).toBe(0)
    expect(await shareInFlight(inFlight, 'k', async () => 3)).toBe(3)
  })
})

describe('createApi().getSavedTracks', () => {
  const pageOf = (n: number): TrackPage => ({ tracks: [], nextCursor: String(n) })

  function setup() {
    const getSavedTracks = vi.fn<(cursor?: string) => Promise<TrackPage>>()
    const provider: MusicProvider = {
      info: SPOTIFY,
      isConnected: async () => true,
      connect: async () => undefined,
      disconnect: async () => undefined,
      getSavedTracks
    }
    return { getSavedTracks, api: createApi(new ProviderRegistry([provider])) }
  }

  it('fetches a page once when the same page is asked for twice at the same moment', async () => {
    const { api, getSavedTracks } = setup()
    const gate = deferred<TrackPage>()
    getSavedTracks.mockReturnValue(gate.promise)

    const both = Promise.all([api.getSavedTracks('spotify'), api.getSavedTracks('spotify')])
    gate.resolve(pageOf(50))

    expect(await both).toEqual([pageOf(50), pageOf(50)])
    expect(getSavedTracks).toHaveBeenCalledOnce()
  })

  it('treats different pages as different requests', async () => {
    const { api, getSavedTracks } = setup()
    getSavedTracks.mockImplementation(async (cursor) => pageOf(Number(cursor ?? 0)))

    await Promise.all([api.getSavedTracks('spotify'), api.getSavedTracks('spotify', '50'), api.getSavedTracks('spotify', '100')])

    expect(getSavedTracks.mock.calls.map((call) => call[0])).toEqual([undefined, '50', '100'])
  })

  it('does not reuse an answer after it has arrived', async () => {
    const { api, getSavedTracks } = setup()
    getSavedTracks.mockResolvedValue(pageOf(1))

    await api.getSavedTracks('spotify')
    await api.getSavedTracks('spotify')

    expect(getSavedTracks).toHaveBeenCalledTimes(2)
  })

  it('still rejects an unknown service, without leaving anything stuck', async () => {
    const { api } = setup()
    await expect(api.getSavedTracks('napster' as never)).rejects.toThrow('Unknown provider')
    await expect(api.getSavedTracks('napster' as never)).rejects.toThrow('Unknown provider')
  })
})
