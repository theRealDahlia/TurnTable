import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { AuthRequiredError } from '../src/main/auth/session'
import type { TokenStore } from '../src/main/auth/tokenStore'
import { createQobuzProvider, streamQuality } from '../src/main/providers/qobuz/provider'
import { QobuzSession, type QobuzTier } from '../src/main/providers/qobuz/session'
import type { TokenSet } from '../src/shared/types'

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })

const file = (overrides: Record<string, unknown> = {}) => ({
  url: 'https://streaming.qobuz.example/file?token=abc',
  mime_type: 'audio/flac',
  bit_depth: 24,
  sampling_rate: 96,
  ...overrides
})

const NOW = 1_700_000_000_000

function setup(responses: Response[], tier: QobuzTier | null = 'hires') {
  const saved = new Map<string, TokenSet>()
  if (tier) saved.set('qobuz', { accessToken: 'user-token', expiresAt: Number.MAX_SAFE_INTEGER, scope: tier })
  const store = { get: async (id: string) => saved.get(id), set: async (id: string, t: TokenSet) => void saved.set(id, t), delete: async (id: string) => void saved.delete(id) }
  const session = new QobuzSession({ app: () => ({ appId: 'app-id-1', appSecret: 'app-secret-1' }), store: store as unknown as TokenStore, fetch: vi.fn() as never, now: () => 0 })
  const fetchFn = vi.fn()
  for (const response of responses) fetchFn.mockResolvedValueOnce(response)
  const provider = createQobuzProvider(session, { fetch: fetchFn as unknown as typeof fetch, app: () => ({ appId: 'app-id-1', appSecret: 'app-secret-1' }), now: () => NOW })
  return { provider, fetchFn, saved }
}

const urlOf = (fetchFn: ReturnType<typeof vi.fn>, call = 0): URL => new URL((fetchFn.mock.calls[call] as [string])[0])
const md5 = (text: string): string => createHash('md5').update(text).digest('hex')

describe('Qobuz getStreamUrl', () => {
  it('asks for the stream with a request signed the way Qobuz requires, using the application secret', async () => {
    const { provider, fetchFn } = setup([json(file())])

    await provider.getStreamUrl('12345')

    const url = urlOf(fetchFn)
    expect(`${url.origin}${url.pathname}`).toBe('https://www.qobuz.com/api.json/0.2/track/getFileUrl')
    const ts = String(Math.floor(NOW / 1000))
    expect(Object.fromEntries(url.searchParams)).toEqual({
      request_ts: ts,
      request_sig: md5(`trackgetFileUrlformat_id27intentstreamtrack_id12345${ts}app-secret-1`),
      track_id: '12345',
      format_id: '27',
      intent: 'stream'
    })
  })

  it('never sends the secret itself', async () => {
    const { provider, fetchFn } = setup([json(file())])
    await provider.getStreamUrl('12345')
    expect(JSON.stringify(fetchFn.mock.calls)).not.toContain('app-secret-1')
  })

  it.each([
    ['hires', 27],
    ['lossless', 6],
    ['lossy', 5]
  ] as const)('asks for the best format a %s subscription has (%i)', async (tier, format) => {
    const { provider, fetchFn } = setup([json(file())], tier)
    await provider.getStreamUrl('1')
    expect(urlOf(fetchFn).searchParams.get('format_id')).toBe(String(format))
    const ts = String(Math.floor(NOW / 1000))
    expect(urlOf(fetchFn).searchParams.get('request_sig')).toBe(md5(`trackgetFileUrlformat_id${format}intentstreamtrack_id1${ts}app-secret-1`))
  })

  it('returns the address and the quality Qobuz says it is', async () => {
    const { provider } = setup([json(file({ bit_depth: 24, sampling_rate: 192 }))])
    expect(await provider.getStreamUrl('1')).toEqual({
      url: 'https://streaming.qobuz.example/file?token=abc',
      quality: { codec: 'flac', lossless: true, bitDepth: 24, sampleRateHz: 192000 }
    })
  })

  it('sends the user\'s token and the application\'s ID', async () => {
    const { provider, fetchFn } = setup([json(file())])
    await provider.getStreamUrl('1')
    expect((fetchFn.mock.calls[0] as [string, RequestInit])[1].headers).toEqual({ 'X-App-Id': 'app-id-1', 'X-User-Auth-Token': 'user-token', Accept: 'application/json' })
  })

  it('refuses an account that cannot stream, without calling Qobuz', async () => {
    const { provider, fetchFn } = setup([], 'none')
    await expect(provider.getStreamUrl('1')).rejects.toThrow("doesn't include streaming")
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('asks the user to sign in when there is no sign-in, without calling Qobuz', async () => {
    const { provider, fetchFn } = setup([], null)
    await expect(provider.getStreamUrl('1')).rejects.toBeInstanceOf(AuthRequiredError)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it.each(['', 'abc', '1,2', '1&format_id=5', '../x', '1\n', '1'.repeat(13)])('refuses the track id %j without calling Qobuz', async (id) => {
    const { provider, fetchFn } = setup([])
    await expect(provider.getStreamUrl(id)).rejects.toThrow('not a valid Qobuz track')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses a preview, or a track Qobuz restricts, rather than playing 30 seconds as if it were the track', async () => {
    await expect(setup([json(file({ sample: true }))]).provider.getStreamUrl('1')).rejects.toThrow('only allows a preview')
    await expect(setup([json(file({ restrictions: [{ code: 'TrackRestrictedByRightHolders' }] }))]).provider.getStreamUrl('1')).rejects.toThrow('only allows a preview')
  })

  it.each([
    ['no address', { url: undefined }],
    ['an empty address', { url: '' }],
    ['a plain http address', { url: 'http://streaming.qobuz.example/file' }],
    ['an address that is not text', { url: 5 }]
  ])('refuses an answer with %s', async (_label, overrides) => {
    await expect(setup([json(file(overrides))]).provider.getStreamUrl('1')).rejects.toThrow('did not give an address')
  })

  it('ends the sign-in when Qobuz refuses the token', async () => {
    const { provider, saved } = setup([new Response(null, { status: 401 })])
    await expect(provider.getStreamUrl('1')).rejects.toBeInstanceOf(AuthRequiredError)
    expect(saved.has('qobuz')).toBe(false)
  })

  it("shows Qobuz's message when it refuses", async () => {
    const { provider } = setup([json({ code: 400, message: 'Invalid signature' }, { status: 400 })])
    await expect(provider.getStreamUrl('1')).rejects.toThrow('Qobuz: Invalid signature (status 400)')
  })
})

describe('streamQuality', () => {
  it('reads FLAC with its depth and rate, in kHz or in Hz', () => {
    expect(streamQuality({ mime_type: 'audio/flac', bit_depth: 24, sampling_rate: 96 }, undefined)).toEqual({ codec: 'flac', lossless: true, bitDepth: 24, sampleRateHz: 96000 })
    expect(streamQuality({ mime_type: 'audio/flac', bit_depth: 16, sampling_rate: 44100 }, undefined)).toEqual({ codec: 'flac', lossless: true, bitDepth: 16, sampleRateHz: 44100 })
    expect(streamQuality({ mime_type: 'audio/flac', bit_depth: 24, sampling_rate: 176.4 }, undefined)).toMatchObject({ sampleRateHz: 176400 })
  })

  it('reads MP3 as 320 kbps lossy', () => {
    expect(streamQuality({ mime_type: 'audio/mpeg' }, undefined)).toEqual({ codec: 'mp3', lossless: false, bitrateKbps: 320 })
  })

  it('falls back to what was expected when the answer does not say', () => {
    expect(streamQuality({ mime_type: 'audio/flac' }, { codec: 'flac', lossless: true, bitDepth: 16, sampleRateHz: 44100 })).toEqual({ codec: 'flac', lossless: true, bitDepth: 16, sampleRateHz: 44100 })
    expect(streamQuality({}, undefined)).toEqual({ codec: 'flac', lossless: true, bitDepth: undefined, sampleRateHz: undefined })
  })
})
