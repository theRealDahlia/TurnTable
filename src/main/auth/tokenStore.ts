import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ProviderId, TokenSet } from '@shared/types'

/** Matches the subset of Electron's `safeStorage` the store needs. */
export interface Encryptor {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

type TokenMap = Partial<Record<ProviderId, TokenSet>>

/**
 * Persists per-provider tokens in a single file encrypted with the OS keychain.
 * It refuses to write anything when encryption is unavailable, so tokens are never stored in plaintext.
 */
export class TokenStore {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly filePath: string,
    private readonly encryptor: Encryptor
  ) {}

  get(id: ProviderId): Promise<TokenSet | undefined> {
    return this.enqueue(async () => (await this.read())[id])
  }

  set(id: ProviderId, tokens: TokenSet): Promise<void> {
    return this.enqueue(async () => this.write({ ...(await this.read()), [id]: tokens }))
  }

  delete(id: ProviderId): Promise<void> {
    return this.enqueue(async () => {
      const tokens = await this.read()
      delete tokens[id]
      await this.write(tokens)
    })
  }

  /**
   * Deletes the sign-ins of every service not in `ids`: those of services the app no longer has. Writes nothing
   * when there is nothing to delete.
   */
  retainOnly(ids: readonly ProviderId[]): Promise<void> {
    return this.enqueue(async () => {
      const tokens = await this.read()
      const kept = Object.fromEntries(Object.entries(tokens).filter(([id]) => (ids as readonly string[]).includes(id))) as TokenMap
      if (Object.keys(kept).length !== Object.keys(tokens).length) await this.write(kept)
    })
  }

  /** Serializes operations so concurrent read-modify-write calls cannot lose updates. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async read(): Promise<TokenMap> {
    let data: Buffer
    try {
      data = await readFile(this.filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
      throw error
    }
    this.assertEncryptionAvailable()
    return JSON.parse(this.encryptor.decrypt(data)) as TokenMap
  }

  private async write(tokens: TokenMap): Promise<void> {
    this.assertEncryptionAvailable()
    await mkdir(dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.tmp`
    await writeFile(temp, this.encryptor.encrypt(JSON.stringify(tokens)), { mode: 0o600 })
    await rename(temp, this.filePath)
  }

  private assertEncryptionAvailable(): void {
    if (!this.encryptor.isAvailable()) throw new Error('Secure token storage is unavailable on this system')
  }
}
