import { describe, expect, it, vi } from 'vitest'
import { AuthRequiredError, type OAuthSession } from '../src/main/auth/session'
import { artistFromChannel, createYouTubeProvider, parseIsoDuration } from '../src/main/providers/youtube/provider'
import { isPlayable, unplayableReason } from '../src/shared/media'

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })

const video = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  snippet: {
    title: `Song ${id}`,
    channelTitle: 'Some Artist - Topic',
    categoryId: '10',
    thumbnails: {
      default: { url: 'https://i.ytimg.com/default.jpg', width: 120 },
      medium: { url: 'https://i.ytimg.com/medium.jpg', width: 320 },
      high: { url: 'https://i.ytimg.com/high.jpg', width: 480 }
    }
  },
  contentDetails: { duration: 'PT3M45S' },
  ...overrides
})

const ID_A = 'abcdefghijk'
const ID_B = 'lmnopqrstuv'

function setup(responses: Response[]) {
  const session = {
    getAccessToken: vi.fn().mockResolvedValue('token-1'),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn(),
    connect: vi.fn()
  }
  const fetchFn = vi.fn()
  for (const response of responses) fetchFn.mockResolvedValueOnce(response)
  const provider = createYouTubeProvider(session as unknown as OAuthSession, { fetch: fetchFn as unknown as typeof fetch })
  return { session, fetchFn, provider }
}

const requestedUrl = (fetchFn: ReturnType<typeof vi.fn>, call = 0): URL => new URL((fetchFn.mock.calls[call] as [string])[0])

describe('parseIsoDuration', () => {
  it.each([
    ['PT3M45S', 225_000],
    ['PT1H2M3S', 3_723_000],
    ['PT45S', 45_000],
    ['PT10M', 600_000],
    ['PT2H', 7_200_000],
    ['P1DT1H', 90_000_000],
    ['P0D', 0],
    ['', 0],
    ['3:45', 0],
    ['PT-5S', 0]
  ])('reads %j as %i ms', (value, expected) => {
    expect(parseIsoDuration(value)).toBe(expected)
  })

  it('treats a missing duration as zero', () => {
    expect(parseIsoDuration(undefined)).toBe(0)
  })
})

describe('artistFromChannel', () => {
  it('drops the " - Topic" suffix of auto-generated artist channels', () => {
    expect(artistFromChannel('Radiohead - Topic')).toEqual(['Radiohead'])
    expect(artistFromChannel('Radiohead')).toEqual(['Radiohead'])
    expect(artistFromChannel('Jay - Topic - Live')).toEqual(['Jay - Topic - Live'])
  })

  it('has no artist when the channel has no name', () => {
    expect(artistFromChannel(undefined)).toEqual([])
    expect(artistFromChannel('')).toEqual([])
  })
})

describe('YouTube getSavedTracks', () => {
  it("asks for the account's liked videos with the access token, and only the fields it shows", async () => {
    const { provider, fetchFn } = setup([json({ items: [video(ID_A)] })])

    await provider.getSavedTracks()

    const url = requestedUrl(fetchFn)
    expect(`${url.origin}${url.pathname}`).toBe('https://www.googleapis.com/youtube/v3/videos')
    expect(url.searchParams.get('myRating')).toBe('like')
    expect(url.searchParams.get('part')).toBe('snippet,contentDetails,status')
    expect(url.searchParams.get('maxResults')).toBe('50')
    expect(url.searchParams.get('fields')).toContain('nextPageToken')
    expect(url.searchParams.has('pageToken')).toBe(false)
    expect(fetchFn.mock.calls[0]?.[1]).toEqual({ method: 'GET', headers: { Authorization: 'Bearer token-1' } })
  })

  it('maps a video to a track', async () => {
    const { provider } = setup([json({ items: [video(ID_A)], nextPageToken: 'CDIQAA' })])

    expect(await provider.getSavedTracks()).toEqual({
      tracks: [
        {
          id: ID_A,
          providerId: 'youtubeMusic',
          title: `Song ${ID_A}`,
          artists: ['Some Artist'],
          durationMs: 225_000,
          artworkUrl: 'https://i.ytimg.com/medium.jpg',
          url: `https://music.youtube.com/watch?v=${ID_A}`
        }
      ],
      nextCursor: 'CDIQAA'
    })
  })

  it("marks a video its owner doesn't allow to be embedded as unplayable, and leaves the rest alone", async () => {
    const { provider } = setup([
      json({ items: [video(ID_A, { status: { embeddable: false } }), video(ID_B, { status: { embeddable: true } }), video('nostatusabc')] })
    ])

    const { tracks } = await provider.getSavedTracks()

    expect(tracks.map((track) => [track.id, track.playable])).toEqual([[ID_A, false], [ID_B, undefined], ['nostatusabc', undefined]])
    expect(tracks[1]).not.toHaveProperty('playable')
  })

  it("does not play a video YouTube marks as made for kids, and says why, since its rules need tracking off for those", async () => {
    const { provider, fetchFn } = setup([
      json({ items: [video(ID_A, { status: { embeddable: true, madeForKids: true } }), video(ID_B, { status: { embeddable: true, madeForKids: false } })] })
    ])

    const { tracks } = await provider.getSavedTracks()

    expect(tracks[0]).toMatchObject({ id: ID_A, playable: false, madeForKids: true })
    expect(tracks[1]).not.toHaveProperty('playable')
    expect(tracks[1]).not.toHaveProperty('madeForKids')
    expect(isPlayable(tracks[0]!)).toBe(false)
    expect(unplayableReason(tracks[0]!)).toMatch(/made for kids/)
    // The status is asked for, so the answer is YouTube's own and always fresh.
    expect(new URL(String(fetchFn.mock.calls[0]![0])).searchParams.get('fields')).toContain('madeForKids')
  })

  it("follows Google's page token and stops when there is none", async () => {
    const { provider, fetchFn } = setup([json({ items: [video(ID_B)] })])

    const page = await provider.getSavedTracks('CDIQAA')

    expect(requestedUrl(fetchFn).searchParams.get('pageToken')).toBe('CDIQAA')
    expect(page.nextCursor).toBeUndefined()
  })

  it('keeps paging through a page that has no music in it', async () => {
    const { provider } = setup([json({ items: [video(ID_A, { snippet: { title: 'A talk', categoryId: '27' } })], nextPageToken: 'NEXT' })])

    expect(await provider.getSavedTracks()).toEqual({ tracks: [], nextCursor: 'NEXT' })
  })

  it('skips videos that are not music, are unavailable, or have no length', async () => {
    const { provider } = setup([
      json({
        items: [
          video(ID_A),
          video('gamegamegam', { snippet: { title: 'Gameplay', categoryId: '20' } }),
          { id: 'removedvideo' },
          video('liveliveliv', { contentDetails: { duration: 'P0D' } }),
          video('badid', {}),
          video('notitlenoti', { snippet: { categoryId: '10' } }),
          { snippet: { title: 'No id', categoryId: '10' } }
        ]
      })
    ])

    expect((await provider.getSavedTracks()).tracks.map((track) => track.id)).toEqual([ID_A])
  })

  it('copes with an empty or missing item list and with videos missing optional details', async () => {
    const { provider } = setup([json({}), json({ items: [video(ID_A, { snippet: { title: 'Bare', categoryId: '10' } })] })])

    expect(await provider.getSavedTracks()).toEqual({ tracks: [], nextCursor: undefined })
    const page = await provider.getSavedTracks()
    expect(page.tracks[0]).toMatchObject({ title: 'Bare', artists: [], artworkUrl: undefined })
  })

  it('picks the smallest sharp thumbnail, else the largest, and ignores non-https ones', async () => {
    const thumbs = (entries: Record<string, { url: string; width: number }>) =>
      json({ items: [video(ID_A, { snippet: { title: 'T', categoryId: '10', thumbnails: entries } })] })
    const { provider } = setup([
      thumbs({ small: { url: 'https://i/s.jpg', width: 120 }, big: { url: 'https://i/b.jpg', width: 480 }, mid: { url: 'https://i/m.jpg', width: 320 } }),
      thumbs({ small: { url: 'https://i/s.jpg', width: 120 }, tiny: { url: 'https://i/t.jpg', width: 90 } }),
      thumbs({ plain: { url: 'http://i/p.jpg', width: 480 } })
    ])

    expect((await provider.getSavedTracks()).tracks[0]?.artworkUrl).toBe('https://i/m.jpg')
    expect((await provider.getSavedTracks()).tracks[0]?.artworkUrl).toBe('https://i/s.jpg')
    expect((await provider.getSavedTracks()).tracks[0]?.artworkUrl).toBeUndefined()
  })

  it.each(['', 'a b', 'x'.repeat(201), '../etc', 'tok&maxResults=1', 'tok=en'])('rejects the page token %j before calling Google', async (cursor) => {
    const { provider, fetchFn } = setup([])
    await expect(provider.getSavedTracks(cursor)).rejects.toThrow('Invalid library cursor')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('YouTube errors', () => {
  it('retries once with a refreshed token after a 401', async () => {
    const { provider, session, fetchFn } = setup([new Response(null, { status: 401 }), json({ items: [video(ID_A)] })])

    expect((await provider.getSavedTracks()).tracks).toHaveLength(1)

    expect(session.getAccessToken).toHaveBeenNthCalledWith(1, { forceRefresh: false })
    expect(session.getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('signs the user out and asks them to reconnect when a refreshed token is still refused', async () => {
    const { provider, session } = setup([new Response(null, { status: 401 }), new Response(null, { status: 401 })])

    const failure = provider.getSavedTracks()
    await expect(failure).rejects.toBeInstanceOf(AuthRequiredError)
    await expect(failure).rejects.toThrow(/YouTube session expired/)
    expect(session.disconnect).toHaveBeenCalledOnce()
  })

  it("shows Google's own message", async () => {
    const { provider } = setup([
      json({ error: { code: 403, message: 'YouTube Data API v3 has not been used in project 123 before.', errors: [{ reason: 'accessNotConfigured' }] } }, { status: 403 })
    ])

    await expect(provider.getSavedTracks()).rejects.toThrow('YouTube: YouTube Data API v3 has not been used in project 123 before. (status 403)')
  })

  it.each(['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded', 'userRateLimitExceeded'])('explains that the allowance is used up (%s) and does not retry', async (reason) => {
    const { provider, fetchFn } = setup([json({ error: { message: 'Quota stuff', errors: [{ reason }] } }, { status: 403 })])

    await expect(provider.getSavedTracks()).rejects.toThrow(/allowance .* used up.*midnight Pacific/)
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('cleans up messages before showing them', async () => {
    const { provider } = setup([json({ error: { message: `bad\u0000\n${'x'.repeat(500)}` } }, { status: 400 })])

    const error = await provider.getSavedTracks().catch((e: Error) => e)
    expect((error as Error).message).not.toMatch(/\p{Cc}/u)
    expect((error as Error).message.length).toBeLessThan(260)
  })

  it.each([
    ['a body that is not JSON', new Response('<html>', { status: 500 })],
    ['an error without a message', json({ error: {} }, { status: 500 })]
  ])('falls back to the status for %s', async (_label, response) => {
    const { provider } = setup([response])
    await expect(provider.getSavedTracks()).rejects.toThrow('YouTube request failed with status 500')
  })
})
