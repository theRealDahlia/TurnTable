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
    await store.set('tidal', { ...tokens, accessToken: 'q' })

    await expect(store.get('spotify')).resolves.toEqual(tokens)
    await expect(store.get('tidal')).resolves.toMatchObject({ accessToken: 'q' })
    expect(await readFile(file, 'utf8')).not.toContain('secret-access')
  })

  it('deletes one provider and leaves the others', async () => {
    const store = new TokenStore(file, fakeEncryptor())
    await store.set('spotify', tokens)
    await store.set('tidal', tokens)
    await store.delete('spotify')

    await expect(store.get('spotify')).resolves.toBeUndefined()
    await expect(store.get('tidal')).resolves.toEqual(tokens)
  })

  it('deletes the sign-ins of services the app no longer has, and keeps the rest', async () => {
    const store = new TokenStore(file, fakeEncryptor())
    await store.set('spotify', tokens)
    await store.set('tidal', tokens)
    // A sign-in left behind by a service since removed from the app.
    await store.set('qobuz' as never, tokens)

    await store.retainOnly(['spotify', 'tidal', 'youtubeMusic', 'local'])

    await expect(store.get('qobuz' as never)).resolves.toBeUndefined()
    await expect(store.get('spotify')).resolves.toEqual(tokens)
    await expect(store.get('tidal')).resolves.toEqual(tokens)
    expect(await readFile(file, 'utf8')).not.toContain('qobuz')
  })

  it('writes nothing when there is nothing to delete, or no file yet', async () => {
    const store = new TokenStore(file, fakeEncryptor())
    await store.retainOnly(['spotify'])
    await expect(readFile(file)).rejects.toThrow()

    await store.set('spotify', tokens)
    const before = await readFile(file)
    await store.retainOnly(['spotify', 'tidal'])
    expect(await readFile(file)).toEqual(before)
  })

  it('does not lose updates when writes happen concurrently', async () => {
    const store = new TokenStore(file, fakeEncryptor())
    await Promise.all([store.set('spotify', tokens), store.set('tidal', tokens), store.set('youtubeMusic', tokens)])

    for (const id of ['spotify', 'tidal', 'youtubeMusic'] as const) {
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
