import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileRateLimitStore, RateLimitGate, RateLimitedError, describeWait, type RateLimitStore } from '../src/main/providers/spotify/rateLimit'

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
/** A local time in mid-June, far from any daylight-saving change. */
const at = (hour: number, minute: number, second = 0, day = 10): number => new Date(2026, 5, day, hour, minute, second).getTime()
const clock = (ms: number): string => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

describe('describeWait', () => {
  const now = at(22, 16, 21)

  it.each([
    [1, 'in about 1 second'],
    [30, 'in about 30 seconds'],
    [89, 'in about 89 seconds'],
    [90, 'in about 2 minutes'],
    [12 * 60, 'in about 12 minutes'],
    [54 * 60, 'in about 54 minutes']
  ])('describes a wait of %i seconds as "%s"', (seconds, expected) => {
    expect(describeWait(now + seconds * SECOND, now)).toBe(expected)
  })

  it('never says zero, even for a deadline that has already passed', () => {
    expect(describeWait(now - 5 * SECOND, now)).toBe('in about 1 second')
    expect(describeWait(now, now)).toBe('in about 1 second')
  })

  it('gives the clock time for waits of about an hour or more', () => {
    // 10:16 PM plus an hour is still today.
    expect(describeWait(now + HOUR, now)).toBe(`at ${clock(now + HOUR)}, in about 1 hour`)
    // An hour starting at 11:30 PM crosses midnight.
    expect(describeWait(at(23, 30) + HOUR, at(23, 30))).toBe(`at ${clock(at(23, 30) + HOUR)} tomorrow, in about 1 hour`)
  })

  it('says "tomorrow" for the next calendar day, with the real wait in hours', () => {
    const until = now + 83_432 * SECOND
    expect(describeWait(until, now)).toBe(`at ${clock(until)} tomorrow, in about 23 hours`)
  })

  it('names the date when the wait reaches past tomorrow', () => {
    const until = now + 3 * 24 * HOUR
    const expectedDate = new Date(until).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    expect(describeWait(until, now)).toBe(`at ${clock(until)} on ${expectedDate}, in about 72 hours`)
  })
})

describe('RateLimitedError', () => {
  it('explains what happened and when to try again, and carries the deadline', () => {
    const now = at(10, 0)
    const error = new RateLimitedError(now + 12 * MINUTE, now)
    expect(error.message).toBe("Spotify has temporarily limited Muze's access (rate limit). Try again in about 12 minutes.")
    expect(error.until).toBe(now + 12 * MINUTE)
    expect(error.name).toBe('RateLimitedError')
  })
})

function memoryStore(initial?: number) {
  const store = {
    saved: initial,
    read: vi.fn(async () => store.saved),
    write: vi.fn(async (value: number | undefined) => void (store.saved = value))
  }
  return store
}

describe('RateLimitGate', () => {
  let time = 1_000_000
  const now = (): number => time
  beforeEach(() => void (time = 1_000_000))

  it('lets everything through until Spotify says to stop', async () => {
    const gate = new RateLimitGate({ store: memoryStore(), now })
    await expect(gate.check()).resolves.toBeUndefined()
  })

  it('blocks for as long as Spotify asked, then lets calls through and forgets the block', async () => {
    const store = memoryStore()
    const gate = new RateLimitGate({ store, now })

    const error = await gate.block(10 * MINUTE)
    expect(error).toBeInstanceOf(RateLimitedError)
    expect(error.until).toBe(time + 10 * MINUTE)

    time += 10 * MINUTE - 1
    await expect(gate.check()).rejects.toBeInstanceOf(RateLimitedError)
    time += 1
    await expect(gate.check()).resolves.toBeUndefined()
    expect(store.saved).toBeUndefined()
  })

  it('saves the deadline, so a new run of the app starts out blocked', async () => {
    const store = memoryStore()
    await new RateLimitGate({ store, now }).block(HOUR)
    expect(store.saved).toBe(time + HOUR)

    const restarted = new RateLimitGate({ store, now })
    await expect(restarted.check()).rejects.toThrow(/rate limit/)
  })

  it('reads the saved deadline only once', async () => {
    const store = memoryStore(time + HOUR)
    const gate = new RateLimitGate({ store, now })
    await expect(gate.check()).rejects.toThrow()
    await expect(gate.check()).rejects.toThrow()
    expect(store.read).toHaveBeenCalledOnce()
  })

  it('never shortens a block that is already in force, but does extend it', async () => {
    const gate = new RateLimitGate({ store: memoryStore(), now })
    await gate.block(HOUR)

    expect((await gate.block(MINUTE)).until).toBe(time + HOUR)
    expect((await gate.block(2 * HOUR)).until).toBe(time + 2 * HOUR)
  })

  it('caps an absurd wait at one week', async () => {
    const error = await new RateLimitGate({ now }).block(10 ** 12)
    expect(error.until).toBe(time + 7 * 24 * HOUR)
  })

  it.each([0, -5000, NaN, Infinity])('does not block for a wait of %s', async (wait) => {
    const gate = new RateLimitGate({ now })
    await gate.block(wait)
    time += 1
    await expect(gate.check()).resolves.toBeUndefined()
  })

  it('works without a store, for the current run only', async () => {
    const gate = new RateLimitGate({ now })
    await gate.block(MINUTE)
    await expect(gate.check()).rejects.toThrow()
  })

  it('keeps working when the saved file cannot be read or written', async () => {
    const broken: RateLimitStore = {
      read: () => Promise.reject(new Error('disk')),
      write: () => Promise.reject(new Error('disk'))
    }
    const gate = new RateLimitGate({ store: broken, now })

    await expect(gate.check()).resolves.toBeUndefined()
    await expect(gate.block(MINUTE)).resolves.toBeInstanceOf(RateLimitedError)
    await expect(gate.check()).rejects.toThrow()
    time += MINUTE
    await expect(gate.check()).resolves.toBeUndefined()
  })
})

describe('FileRateLimitStore', () => {
  let dir: string
  let file: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'turntable-ratelimit-'))
    file = join(dir, 'nested', 'limit.json')
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('has nothing saved at first', async () => {
    expect(await new FileRateLimitStore(file).read()).toBeUndefined()
  })

  it('saves and reads back a deadline, creating the folder', async () => {
    const store = new FileRateLimitStore(file)
    await store.write(1_234_567_890_123)
    expect(await new FileRateLimitStore(file).read()).toBe(1_234_567_890_123)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ blockedUntil: 1_234_567_890_123 })
  })

  it('removes the file when the block ends, and tolerates there being none', async () => {
    const store = new FileRateLimitStore(file)
    await store.write(5)
    await store.write(undefined)
    expect(await store.read()).toBeUndefined()
    await expect(store.write(undefined)).resolves.toBeUndefined()
  })

  it.each([
    ['not JSON', '{oops'],
    ['an array', '[1,2]'],
    ['null', 'null'],
    ['a missing field', '{}'],
    ['a string deadline', '{"blockedUntil":"soon"}'],
    ['a null deadline', '{"blockedUntil":null}']
  ])('treats a file containing %s as no block', async (_label, content) => {
    await new FileRateLimitStore(file).write(1)
    await writeFile(file, content)
    expect(await new FileRateLimitStore(file).read()).toBeUndefined()
  })
})
