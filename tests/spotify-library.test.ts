import { describe, expect, it, vi } from 'vitest'
import { AuthRequiredError, type OAuthSession } from '../src/main/auth/session'
import { createSpotifyProvider } from '../src/main/providers/spotify/provider'

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })

const item = (id: string | null, overrides = {}) => ({
  added_at: '2026-01-02T03:04:05Z',
  track: {
    id,
    name: `Song ${id}`,
    duration_ms: 200_000,
    artists: [{ name: 'Artist A' }, { name: 'Artist B' }],
    album: {
      name: 'Album',
      images: [
        { url: 'https://img/640', width: 640 },
        { url: 'https://img/300', width: 300 },
        { url: 'https://img/64', width: 64 }
      ]
    },
    ...overrides
  }
})

function setup(responses: Response[]) {
  const session = {
    getAccessToken: vi.fn().mockResolvedValue('token-1'),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn(),
    connect: vi.fn()
  }
  const fetchFn = vi.fn()
  for (const response of responses) fetchFn.mockResolvedValueOnce(response)
  const provider = createSpotifyProvider(session as unknown as OAuthSession, fetchFn as unknown as typeof fetch)
  return { session, fetchFn, provider }
}

describe('Spotify getSavedTracks', () => {
  it('requests the first page with the access token and maps tracks', async () => {
    const { provider, fetchFn } = setup([json({ items: [item('abc')], next: null })])

    const page = await provider.getSavedTracks()

    expect(fetchFn).toHaveBeenCalledWith('https://api.spotify.com/v1/me/tracks?limit=50&offset=0', {
      headers: { Authorization: 'Bearer token-1' }
    })
    expect(page).toEqual({
      tracks: [
        {
          id: 'abc',
          providerId: 'spotify',
          title: 'Song abc',
          artists: ['Artist A', 'Artist B'],
          album: 'Album',
          durationMs: 200_000,
          artworkUrl: 'https://img/300',
          savedAt: '2026-01-02T03:04:05Z'
        }
      ],
      nextCursor: undefined
    })
  })

  it('pages by offset and stops on the last page', async () => {
    const full = Array.from({ length: 50 }, (_, i) => item(`t${i}`))
    const { provider, fetchFn } = setup([
      json({ items: full, next: 'https://api.spotify.com/v1/me/tracks?offset=50' }),
      json({ items: [item('last')], next: null })
    ])

    const first = await provider.getSavedTracks()
    expect(first.tracks).toHaveLength(50)
    expect(first.nextCursor).toBe('50')

    const second = await provider.getSavedTracks(first.nextCursor)
    expect(fetchFn.mock.calls[1]![0]).toContain('offset=50')
    expect(second.nextCursor).toBeUndefined()
  })

  it('skips removed tracks, local files and tracks without an id, but still advances the cursor over them', async () => {
    const { provider } = setup([
      json({
        items: [item('ok'), { added_at: 'x', track: null }, item('local', { is_local: true }), item(null)],
        next: 'https://api.spotify.com/v1/me/tracks?offset=4'
      })
    ])

    const page = await provider.getSavedTracks()

    expect(page.tracks.map((t) => t.id)).toEqual(['ok'])
    expect(page.nextCursor).toBe('4')
  })

  it('does not loop forever if Spotify claims more pages but returns none', async () => {
    const { provider } = setup([json({ items: [], next: 'https://api.spotify.com/v1/me/tracks?offset=0' })])
    expect((await provider.getSavedTracks()).nextCursor).toBeUndefined()
  })

  it('handles tracks with no album or artwork', async () => {
    const { provider } = setup([json({ items: [item('a', { album: undefined })], next: null })])
    const [track] = (await provider.getSavedTracks()).tracks
    expect(track).toMatchObject({ album: undefined, artworkUrl: undefined })
  })

  it('falls back to the largest image when none is big enough', async () => {
    const images = [
      { url: 'https://img/64', width: 64 },
      { url: 'https://img/200', width: 200 }
    ]
    const { provider } = setup([json({ items: [item('a', { album: { name: 'A', images } })], next: null })])
    expect((await provider.getSavedTracks()).tracks[0]!.artworkUrl).toBe('https://img/200')
  })

  it.each(['-1', '1.5', 'abc', '99999999999', '50&limit=1', ''])('rejects the invalid cursor %j', async (cursor) => {
    const { provider, fetchFn } = setup([])
    await expect(provider.getSavedTracks(cursor)).rejects.toThrow('Invalid library cursor')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('retries once with a force-refreshed token after a 401', async () => {
    const { provider, session, fetchFn } = setup([
      new Response(null, { status: 401 }),
      json({ items: [item('abc')], next: null })
    ])
    session.getAccessToken.mockResolvedValueOnce('stale').mockResolvedValueOnce('fresh')

    const page = await provider.getSavedTracks()

    expect(page.tracks).toHaveLength(1)
    expect(session.getAccessToken).toHaveBeenNthCalledWith(1, { forceRefresh: false })
    expect(session.getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true })
    expect(fetchFn.mock.calls[1]![1]).toEqual({ headers: { Authorization: 'Bearer fresh' } })
  })

  it('signs the user out when a refreshed token is still rejected', async () => {
    const { provider, session } = setup([new Response(null, { status: 401 }), new Response(null, { status: 401 })])

    await expect(provider.getSavedTracks()).rejects.toBeInstanceOf(AuthRequiredError)
    expect(session.disconnect).toHaveBeenCalledOnce()
  })

  it('reports rate limiting with the wait time', async () => {
    const { provider } = setup([new Response(null, { status: 429, headers: { 'Retry-After': '7' } })])
    await expect(provider.getSavedTracks()).rejects.toThrow('Try again in 7s')
  })

  it('reports other API failures without leaking the response body', async () => {
    const { provider } = setup([new Response('internal detail', { status: 500 })])
    const error = await provider.getSavedTracks().catch((e: Error) => e)
    expect((error as Error).message).toBe('Spotify request failed with status 500')
  })

  it('asks the user to reconnect when the session is gone', async () => {
    const { provider, session } = setup([])
    session.getAccessToken.mockRejectedValue(new AuthRequiredError('Spotify'))
    await expect(provider.getSavedTracks()).rejects.toThrow('Please reconnect')
  })
})
