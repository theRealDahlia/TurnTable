import { describe, expect, it, vi } from 'vitest'
import { AuthRequiredError, type OAuthSession } from '../src/main/auth/session'
import { createSpotifyProvider } from '../src/main/providers/spotify/provider'

const TRACK = '4iV5W9uYEdYUVa79Axb7Rh'
const DEVICE = 'abcdef0123456789abcdef0123456789abcdef01'

function setup(responses: Response[]) {
  const session = {
    getAccessToken: vi.fn().mockResolvedValue('token-1'),
    disconnect: vi.fn().mockResolvedValue(undefined)
  }
  const fetchFn = vi.fn()
  for (const response of responses) fetchFn.mockResolvedValueOnce(response)
  const sleep = vi.fn().mockResolvedValue(undefined)
  const provider = createSpotifyProvider(session as unknown as OAuthSession, { fetch: fetchFn as unknown as typeof fetch, sleep, random: () => 0 })
  return { provider, session, fetchFn, sleep }
}

const noContent = (): Response => new Response(null, { status: 204 })

describe('Spotify startPlayback', () => {
  it('asks Spotify to play the track on the player-page device', async () => {
    const { provider, fetchFn } = setup([noContent()])

    await provider.startPlayback(DEVICE, TRACK)

    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://api.spotify.com/v1/me/player/play?device_id=${DEVICE}`)
    expect(init.method).toBe('PUT')
    expect(init.headers).toEqual({ Authorization: 'Bearer token-1', 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual({ uris: [`spotify:track:${TRACK}`], position_ms: 0 })
  })

  it.each(['', 'short', `${TRACK}x`, '../../me', 'spotify:track:abc', `${TRACK.slice(0, 21)}!`, `${TRACK}\n`])(
    'rejects the invalid track id %j without calling Spotify',
    async (trackId) => {
      const { provider, fetchFn } = setup([])
      await expect(provider.startPlayback(DEVICE, trackId)).rejects.toThrow('not a valid Spotify track')
      expect(fetchFn).not.toHaveBeenCalled()
    }
  )

  it.each(['', 'x', 'a'.repeat(101), 'abc/def&play=1', 'dev ice12345', 'device?id=1234'])(
    'rejects the invalid device id %j without calling Spotify',
    async (deviceId) => {
      const { provider, fetchFn } = setup([])
      await expect(provider.startPlayback(deviceId, TRACK)).rejects.toThrow('not ready')
      expect(fetchFn).not.toHaveBeenCalled()
    }
  )

  it('shows Spotify\'s own explanation when it refuses, e.g. a free account', async () => {
    const body = JSON.stringify({ error: { status: 403, message: 'Player command failed: Premium required' } })
    const { provider } = setup([new Response(body, { status: 403 })])
    await expect(provider.startPlayback(DEVICE, TRACK)).rejects.toThrow('Premium required (status 403)')
  })

  it('explains a device that has disappeared', async () => {
    const body = JSON.stringify({ error: { status: 404, message: 'Device not found' } })
    const { provider } = setup([new Response(body, { status: 404 })])
    await expect(provider.startPlayback(DEVICE, TRACK)).rejects.toThrow('Device not found')
  })

  it('retries once with a refreshed token after a 401, resending the same request body', async () => {
    const { provider, session, fetchFn } = setup([new Response(null, { status: 401 }), noContent()])
    session.getAccessToken.mockResolvedValueOnce('stale').mockResolvedValueOnce('fresh')

    await provider.startPlayback(DEVICE, TRACK)

    expect(session.getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true })
    const [first, second] = fetchFn.mock.calls as [string, RequestInit][]
    expect((second![1].headers as Record<string, string>).Authorization).toBe('Bearer fresh')
    expect(second![1].body).toBe(first![1].body)
    expect(second![1].method).toBe('PUT')
  })

  it('signs the user out when a refreshed token is still rejected', async () => {
    const { provider, session } = setup([new Response(null, { status: 401 }), new Response(null, { status: 401 })])
    await expect(provider.startPlayback(DEVICE, TRACK)).rejects.toBeInstanceOf(AuthRequiredError)
    expect(session.disconnect).toHaveBeenCalledOnce()
  })

  it('stops at a 429 instead of retrying the PUT, and says when to try again', async () => {
    const { provider, sleep, fetchFn } = setup([new Response(null, { status: 429, headers: { 'Retry-After': '2' } }), noContent()])

    await expect(provider.startPlayback(DEVICE, TRACK)).rejects.toThrow(/rate limit/)

    expect(sleep).not.toHaveBeenCalled()
    expect(fetchFn).toHaveBeenCalledOnce()
  })
})
