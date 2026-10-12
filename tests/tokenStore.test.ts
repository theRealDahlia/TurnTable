import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TokenStore, type Encryptor } from '../src/main/auth/tokenStore'

/** Reversible stand-in for the OS keychain; the point is that the file is not plain JSON. */
const fakeEncryptor = (available = true): Encryptor => ({
  isAvailable: () => available,
  encrypt: (plain) => Buffer.from(plain, 'utf8').reverse(),
  decrypt: (data) => Buffer.from(data).reverse().toString('utf8')
})

const tokens = { accessToken: 'secret-access', refreshToken: 'secret-refresh', expiresAt: 5 }

describe('TokenStore', () => {
  let dir: string
  let file: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'turntable-'))
    file = join(dir, 'nested', 'tokens.bin')
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it('returns undefined when nothing is stored', async () => {
    await expect(new TokenStore(file, fakeEncryptor()).get('spotify')).resolves.toBeUndefined()
  })

  it('round-trips tokens per provider without storing plaintext', async () => {
    const store = new TokenStore(file, fakeEncryptor())
    await store.set('spotify', tokens)
    await store.set('qobuz', { ...tokens, accessToken: 'q' })

    await expect(store.get('spotify')).resolves.toEqual(tokens)
    await expect(store.get('qobuz')).resolves.toMatchObject({ accessToken: 'q' })
    expect(await readFile(file, 'utf8')).not.toContain('secret-access')
  })

  it('deletes one provider and leaves the others', async () => {
    const store = new TokenStore(file, fakeEncryptor())
    await store.set('spotify', tokens)
    await store.set('qobuz', tokens)
    await store.delete('spotify')

    await expect(store.get('spotify')).resolves.toBeUndefined()
    await expect(store.get('qobuz')).resolves.toEqual(tokens)
  })

  it('does not lose updates when writes happen concurrently', async () => {
    const store = new TokenStore(file, fakeEncryptor())
    await Promise.all([store.set('spotify', tokens), store.set('qobuz', tokens), store.set('youtubeMusic', tokens)])

    for (const id of ['spotify', 'qobuz', 'youtubeMusic'] as const) {
      await expect(store.get(id)).resolves.toEqual(tokens)
    }
  })

  it('refuses to write when secure storage is unavailable', async () => {
    const store = new TokenStore(file, fakeEncryptor(false))
    await expect(store.set('spotify', tokens)).rejects.toThrow('unavailable')
  })

  it('keeps working after a failed operation', async () => {
    const store = new TokenStore(file, fakeEncryptor(false))
    await expect(store.set('spotify', tokens)).rejects.toThrow()
    await expect(store.get('spotify')).resolves.toBeUndefined()
  })
})
