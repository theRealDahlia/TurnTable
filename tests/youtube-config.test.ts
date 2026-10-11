import { describe, expect, it, vi } from 'vitest'
import { OAuthClient } from '../src/main/auth/oauth'
import { YOUTUBE_SCOPES, youtubeOAuthConfig } from '../src/main/providers/youtube/config'

const tokenResponse = (): Response =>
  new Response(JSON.stringify({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })

describe('youtubeOAuthConfig', () => {
  it('explains how to set up when there is no client id', () => {
    expect(() => youtubeOAuthConfig(undefined)).toThrow(/MAIN_VITE_YOUTUBE_CLIENT_ID/)
    expect(() => youtubeOAuthConfig('')).toThrow(/MAIN_VITE_YOUTUBE_CLIENT_ID/)
  })

  it('asks only for the one scope that can both read and rate videos', () => {
    expect(YOUTUBE_SCOPES).toEqual(['https://www.googleapis.com/auth/youtube.force-ssl'])
    expect(youtubeOAuthConfig('id').scopes).toEqual(YOUTUBE_SCOPES)
  })

  it("uses Google's endpoints over https, with a free loopback port and a request for a refresh token", () => {
    const config = youtubeOAuthConfig('id')
    expect(config.authorizeUrl).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(config.tokenUrl).toBe('https://oauth2.googleapis.com/token')
    expect(config.loopbackPort).toBeUndefined()
    expect(config.extraAuthParams).toEqual({ access_type: 'offline', prompt: 'consent' })
  })

  it('treats an empty client secret as none', () => {
    expect(youtubeOAuthConfig('id', '').clientSecret).toBeUndefined()
    expect(youtubeOAuthConfig('id', 'shh').clientSecret).toBe('shh')
  })
})

describe('client secret in token requests', () => {
  const grants = async (clientSecret: string | undefined) => {
    const fetchMock = vi.fn(async () => tokenResponse())
    const client = new OAuthClient({ openUrl: async () => undefined, fetch: fetchMock as never, now: () => 0 })
    await client.refresh({ ...youtubeOAuthConfig('id', clientSecret) }, 'old-refresh')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    return { url, body: init.body as URLSearchParams }
  }

  it('is sent to the token endpoint when the service needs one', async () => {
    const { url, body } = await grants('shh')
    expect(url).toBe('https://oauth2.googleapis.com/token')
    expect(body.get('client_secret')).toBe('shh')
    expect(body.get('client_id')).toBe('id')
  })

  it('is left out otherwise', async () => {
    expect((await grants(undefined)).body.has('client_secret')).toBe(false)
  })
})
