import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Whatever Spotify asks for, never stay blocked longer than this, so a garbled header can't lock the app out for good. */
const MAX_BLOCK_MS = 7 * 24 * 60 * 60 * 1000

const SECOND = 1000

/** Remembers a block (an epoch-ms deadline) between launches. */
export interface RateLimitStore {
  read(): Promise<number | undefined>
  write(blockedUntil: number | undefined): Promise<void>
}

/** Keeps the deadline in a small file. It is a time, not Spotify content, so it is fine to keep on disk. */
export class FileRateLimitStore implements RateLimitStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<number | undefined> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      const value = typeof parsed === 'object' && parsed !== null ? (parsed as { blockedUntil?: unknown }).blockedUntil : undefined
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined
    } catch {
      return undefined
    }
  }

  async write(blockedUntil: number | undefined): Promise<void> {
    if (blockedUntil === undefined) {
      await rm(this.filePath, { force: true })
      return
    }
    await mkdir(dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.tmp`
    await writeFile(temp, JSON.stringify({ blockedUntil }))
    await rename(temp, this.filePath)
  }
}

/** "in about 12 minutes", or for long waits the clock time: "at 9:27 PM tomorrow, in about 23 hours". */
export function describeWait(until: number, now: number): string {
  const seconds = Math.max(1, Math.ceil((until - now) / SECOND))
  if (seconds < 90) return `in about ${seconds} second${seconds === 1 ? '' : 's'}`
  if (seconds < 55 * 60) return `in about ${Math.ceil(seconds / 60)} minutes`

  const at = new Date(until)
  const today = new Date(now)
  const clock = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  let day = ''
  if (at.toDateString() === tomorrow.toDateString()) day = ' tomorrow'
  else if (at.toDateString() !== today.toDateString()) day = ` on ${at.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`
  const hours = Math.max(1, Math.round(seconds / 3600))
  return `at ${clock}${day}, in about ${hours} hour${hours === 1 ? '' : 's'}`
}

/** Spotify has asked TurnTable to stop for a while; no request is made until then. */
export class RateLimitedError extends Error {
  constructor(
    readonly until: number,
    now: number
  ) {
    super(`Spotify has temporarily limited TurnTable's access (rate limit). Try again ${describeWait(until, now)}.`)
    this.name = 'RateLimitedError'
  }
}

export interface RateLimitGateDeps {
  store?: RateLimitStore
  now(): number
}

/**
 * Honors Spotify's Retry-After. Once Spotify says to wait, every call fails here, instantly and without
 * touching the network, until the deadline passes: reloads, Retry buttons and restarts can't pile on.
 */
export class RateLimitGate {
  private blockedUntil?: number
  private loaded = false

  constructor(private readonly deps: RateLimitGateDeps) {}

  /** Throws RateLimitedError while a block is in force. */
  async check(): Promise<void> {
    await this.load()
    const now = this.deps.now()
    if (this.blockedUntil === undefined) return
    if (now < this.blockedUntil) throw new RateLimitedError(this.blockedUntil, now)
    this.blockedUntil = undefined
    await this.deps.store?.write(undefined).catch(() => undefined)
  }

  /** Records that Spotify asked us to wait `waitMs`, and returns the error to report. */
  async block(waitMs: number): Promise<RateLimitedError> {
    await this.load()
    const now = this.deps.now()
    const wait = Number.isFinite(waitMs) ? Math.min(Math.max(0, waitMs), MAX_BLOCK_MS) : 0
    const until = now + wait
    // Never shorten a block that is already in force.
    this.blockedUntil = Math.max(this.blockedUntil ?? 0, until)
    await this.deps.store?.write(this.blockedUntil).catch(() => undefined)
    return new RateLimitedError(this.blockedUntil, now)
  }

  private async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    this.blockedUntil = await this.deps.store?.read().catch(() => undefined)
  }
}
