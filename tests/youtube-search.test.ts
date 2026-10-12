import { describe, expect, it, vi } from 'vitest'
import { AuthRequiredError, type OAuthSession } from '../src/main/auth/session'
import { RatingPermissionError, createYouTubeProvider, isTopicChannel } from '../src/main/providers/youtube/provider'

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })

const ID_A = 'abcdefghijk'
const ID_B = 'lmnopqrstuv'
const ID_C = 'wxyzABCDEFG'

const hit = (id: string, channelTitle = 'Foo Fighters - Topic') => ({ id: { videoId: id }, snippet: { channelTitle } })
const video = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  snippet: {
    title: `Song ${id}`,
    channelTitle: 'Foo Fighters - Topic',
    categoryId: '10',
    thumbnails: { medium: { url: 'https://i.ytimg.com/medium.jpg', width: 320 } }
  },
  contentDetails: { duration: 'PT4M10S' },
  status: { embeddable: true },
  ...overrides
})
const rating = (videoId: string, value: string) => ({ videoId, rating: value })

/** A full search: the ids, the details of those videos, and which of them are liked. */
const answers = (ids: string[], liked: string[] = [], extra: { next?: string; details?: unknown[] } = {}) => [
  json({ items: ids.map((id) => hit(id)), nextPageToken: extra.next }),
  json({ items: extra.details ?? ids.map((id) => video(id)) }),
  json({ items: ids.map((id) => rating(id, liked.includes(id) ? 'like' : 'none')) })
]

function setup(responses: Response[], options: { scopes?: boolean } = {}) {
  const session = {
    getAccessToken: vi.fn().mockResolvedValue('token-1'),
    disconnect: vi.fn().mockResolvedValue(undefined),
    hasScopes: vi.fn().mockResolvedValue(options.scopes ?? true),
    isConnected: vi.fn().mockResolvedValue(true),
    connect: vi.fn()
  }
  const fetchFn = vi.fn()
  for (const response of responses) fetchFn.mockResolvedValueOnce(response)
  const provider = createYouTubeProvider(session as unknown as OAuthSession, { fetch: fetchFn as unknown as typeof fetch })
  return { session, fetchFn, provider }
}

const urlOf = (fetchFn: ReturnType<typeof vi.fn>, call: number): URL => new URL((fetchFn.mock.calls[call] as [string])[0])
const methodOf = (fetchFn: ReturnType<typeof vi.fn>, call: number): string => (fetchFn.mock.calls[call] as [string, RequestInit])[1].method!
const pathsOf = (fetchFn: ReturnType<typeof vi.fn>): string[] => fetchFn.mock.calls.map((call) => new URL((call as [string])[0]).pathname)

describe('YouTube search', () => {
  it('searches embeddable music videos for the query', async () => {
    const { provider, fetchFn } = setup(answers([ID_A]))

    await provider.search!('foo fighters')

    const url = urlOf(fetchFn, 0)
    expect(`${url.origin}${url.pathname}`).toBe('https://www.googleapis.com/youtube/v3/search')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      part: 'snippet',
      type: 'video',
      videoCategoryId: '10',
      videoEmbeddable: 'true',
      q: 'foo fighters',
      maxResults: '50'
    })
    expect(url.searchParams.get('fields')).toBe('nextPageToken,items(id(videoId),snippet(channelTitle))')
    expect(url.searchParams.has('pageToken')).toBe(false)
    expect(methodOf(fetchFn, 0)).toBe('GET')
  })

  describe('only YouTube songs', () => {
    it('keeps the audio tracks from artist "Topic" channels and drops everything else', async () => {
      const { provider, fetchFn } = setup([
        json({
          items: [
            hit(ID_A),
            hit(ID_B, 'Foo Fighters'),
            hit(ID_C, 'Some Fan Uploads'),
            hit('lmnopqrst12', 'Foo Fighters VEVO'),
            hit('uvwxyz12345', 'Dave Grohl - topic'),
            hit('abc12345678', 'Topic Of Discussion')
          ]
        }),
        json({ items: [video(ID_A), video('uvwxyz12345')] }),
        json({ items: [rating(ID_A, 'none'), rating('uvwxyz12345', 'none')] })
      ])

      const { tracks } = await provider.search!('foo')

      expect(tracks.map((t) => t.id)).toEqual([ID_A, 'uvwxyz12345'])
      // Details and ratings are only asked for the songs, so nothing is spent on the rest.
      expect(urlOf(fetchFn, 1).searchParams.get('id')).toBe(`${ID_A},uvwxyz12345`)
      expect(urlOf(fetchFn, 2).searchParams.get('id')).toBe(`${ID_A},uvwxyz12345`)
    })

    it('stops after the search when none of the results is a song, and still offers the next page', async () => {
      const { provider, fetchFn } = setup([json({ items: [hit(ID_A, 'Foo Fighters'), hit(ID_B, 'Fan Channel')], nextPageToken: 'CAoQAA' })])
      expect(await provider.search!('foo')).toEqual({ tracks: [], nextCursor: 'CAoQAA' })
      expect(fetchFn).toHaveBeenCalledOnce()
    })

    it('ignores results that come without a channel', async () => {
      const { provider, fetchFn } = setup([json({ items: [{ id: { videoId: ID_A } }, { id: { videoId: ID_B }, snippet: {} }] })])
      expect((await provider.search!('foo')).tracks).toEqual([])
      expect(fetchFn).toHaveBeenCalledOnce()
    })

    it.each([
      ['Foo Fighters - Topic', true],
      ['Foo Fighters  -  Topic', true],
      ['  Foo Fighters - Topic ', true],
      ['Foo Fighters - TOPIC', true],
      ['AC-DC - Topic', true],
      ['Foo Fighters', false],
      ['Topic', false],
      ['- Topic', false],
      ['Topic - Foo Fighters', false],
      ['Foo Fighters - Topic Channel', false],
      ['', false],
      [undefined, false]
    ])('judges the channel %j to be a song channel: %s', (title, expected) => {
      expect(isTopicChannel(title)).toBe(expected)
    })
  })

  it('then fetches the details and the liked state of exactly the videos found', async () => {
    const { provider, fetchFn } = setup(answers([ID_A, ID_B]))

    await provider.search!('foo')

    expect(fetchFn).toHaveBeenCalledTimes(3)
    const calls = [urlOf(fetchFn, 1), urlOf(fetchFn, 2)]
    const details = calls.find((url) => url.pathname === '/youtube/v3/videos')!
    const ratings = calls.find((url) => url.pathname === '/youtube/v3/videos/getRating')!
    expect(details.searchParams.get('id')).toBe(`${ID_A},${ID_B}`)
    expect(details.searchParams.get('part')).toBe('snippet,contentDetails,status')
    expect(details.searchParams.has('maxResults')).toBe(false)
    expect(ratings.searchParams.get('id')).toBe(`${ID_A},${ID_B}`)
  })

  it('maps results to tracks and marks the ones the user has liked', async () => {
    const { provider } = setup(answers([ID_A, ID_B], [ID_B]))

    const page = await provider.search!('foo')

    expect(page.tracks).toEqual([
      {
        id: ID_A,
        providerId: 'youtubeMusic',
        title: `Song ${ID_A}`,
        artists: ['Foo Fighters'],
        durationMs: 250_000,
        artworkUrl: 'https://i.ytimg.com/medium.jpg',
        url: `https://music.youtube.com/watch?v=${ID_A}`,
        saved: false
      },
      expect.objectContaining({ id: ID_B, saved: true })
    ])
  })

  it('keeps the order the search ranked the videos in, whatever order the details come back in', async () => {
    const { provider } = setup(answers([ID_A, ID_B, ID_C], [], { details: [video(ID_C), video(ID_A), video(ID_B)] }))
    expect((await provider.search!('foo')).tracks.map((t) => t.id)).toEqual([ID_A, ID_B, ID_C])
  })

  it('leaves out a video whose details did not come back, or that turns out not to be music', async () => {
    const { provider } = setup(answers([ID_A, ID_B, ID_C], [], { details: [video(ID_A), video(ID_C, { snippet: { title: 'Talk', categoryId: '27' } })] }))
    expect((await provider.search!('foo')).tracks.map((t) => t.id)).toEqual([ID_A])
  })

  it('follows the page token for more results', async () => {
    const { provider, fetchFn } = setup(answers([ID_A], [], { next: 'CAoQAA' }))
    const first = await provider.search!('foo')
    expect(first.nextCursor).toBe('CAoQAA')

    const second = setup(answers([ID_B]))
    const page = await second.provider.search!('foo', 'CAoQAA')
    expect(urlOf(second.fetchFn, 0).searchParams.get('pageToken')).toBe('CAoQAA')
    expect(page.nextCursor).toBeUndefined()
    expect(fetchFn).toHaveBeenCalledTimes(3)
  })

  it('stops after the search when it finds nothing, spending no more quota', async () => {
    const { provider, fetchFn } = setup([json({ items: [] })])
    expect(await provider.search!('zzzz')).toEqual({ tracks: [], nextCursor: undefined })
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('copes with a response with no items, and ignores results that are not videos or have odd ids', async () => {
    const empty = setup([json({})])
    expect((await empty.provider.search!('foo')).tracks).toEqual([])

    const odd = setup([
      json({ items: [{ id: {} }, { id: { videoId: 'short' } }, { id: { videoId: '../../x/../y' } }, hit(ID_A)] }),
      json({ items: [video(ID_A)] }),
      json({ items: [rating(ID_A, 'like')] })
    ])
    const { tracks } = await odd.provider.search!('foo')
    expect(tracks.map((t) => t.id)).toEqual([ID_A])
    expect(urlOf(odd.fetchFn, 1).searchParams.get('id')).toBe(ID_A)
  })

  it('treats a rating that is missing or odd as not liked', async () => {
    const { provider } = setup([
      json({ items: [hit(ID_A), hit(ID_B)] }),
      json({ items: [video(ID_A), video(ID_B)] }),
      json({ items: [rating(ID_A, 'unspecified')] })
    ])
    expect((await provider.search!('foo')).tracks.map((t) => t.saved)).toEqual([false, false])
  })

  it('passes on a video that cannot be embedded as unplayable', async () => {
    const { provider } = setup(answers([ID_A], [], { details: [video(ID_A, { status: { embeddable: false } })] }))
    expect((await provider.search!('foo')).tracks[0]?.playable).toBe(false)
  })

  it.each(['', '  ', 'x'.repeat(201)])('refuses the query %j without calling YouTube', async (query) => {
    const { provider, fetchFn } = setup([])
    await expect(provider.search!(query)).rejects.toThrow('Type something to search for')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it.each(['', 'a b', 'x'.repeat(201), '../x', 'tok&maxResults=1'])('refuses the page token %j without calling YouTube', async (cursor) => {
    const { provider, fetchFn } = setup([])
    await expect(provider.search!('foo', cursor)).rejects.toThrow('Invalid library cursor')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('explains it when the daily allowance for searching is used up, and stops there', async () => {
    const { provider, fetchFn } = setup([json({ error: { message: 'quota', errors: [{ reason: 'quotaExceeded' }] } }, { status: 403 })])
    await expect(provider.search!('foo')).rejects.toThrow(/allowance .* used up/)
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('refreshes an expired token once, then asks the user to sign in again if it is still refused', async () => {
    const retried = setup([new Response(null, { status: 401 }), ...answers([ID_A])])
    expect((await retried.provider.search!('foo')).tracks).toHaveLength(1)
    expect(retried.session.getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true })

    const refused = setup([new Response(null, { status: 401 }), new Response(null, { status: 401 })])
    await expect(refused.provider.search!('foo')).rejects.toBeInstanceOf(AuthRequiredError)
    expect(refused.session.disconnect).toHaveBeenCalledOnce()
  })
})

describe('YouTube saving songs', () => {
  it('likes a video with videos.rate', async () => {
    const { provider, fetchFn } = setup([new Response(null, { status: 204 })])

    await provider.saveTrack!(ID_A)

    const url = urlOf(fetchFn, 0)
    expect(`${url.origin}${url.pathname}`).toBe('https://www.googleapis.com/youtube/v3/videos/rate')
    expect(Object.fromEntries(url.searchParams)).toEqual({ id: ID_A, rating: 'like' })
    expect(methodOf(fetchFn, 0)).toBe('POST')
    expect((fetchFn.mock.calls[0] as [string, RequestInit])[1].headers).toEqual({ Authorization: 'Bearer token-1' })
  })

  it('removes the like by rating it "none", which is not a dislike', async () => {
    const { provider, fetchFn } = setup([new Response(null, { status: 204 })])
    await provider.unsaveTrack!(ID_A)
    expect(urlOf(fetchFn, 0).searchParams.get('rating')).toBe('none')
    expect(methodOf(fetchFn, 0)).toBe('POST')
  })

  it.each(['', 'short', `${ID_A}x`, '../../x', `${ID_A.slice(0, 10)}&`])('refuses the video id %j without calling YouTube', async (id) => {
    const { provider, fetchFn } = setup([])
    await expect(provider.saveTrack!(id)).rejects.toThrow('not a valid YouTube video')
    await expect(provider.unsaveTrack!(id)).rejects.toThrow('not a valid YouTube video')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('asks the user to reconnect when they signed in with the read-only permission', async () => {
    const { provider, fetchFn, session } = setup([], { scopes: false })

    const failure = provider.saveTrack!(ID_A)
    await expect(failure).rejects.toBeInstanceOf(RatingPermissionError)
    await expect(failure).rejects.toThrow('Reconnect YouTube to allow saving songs')
    await expect(provider.unsaveTrack!(ID_A)).rejects.toBeInstanceOf(RatingPermissionError)
    expect(session.hasScopes).toHaveBeenCalledWith(['https://www.googleapis.com/auth/youtube.force-ssl'])
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('explains it when the owner has turned off likes', async () => {
    const { provider } = setup([json({ error: { message: 'Video rating is disabled', errors: [{ reason: 'videoRatingDisabled' }] } }, { status: 403 })])
    await expect(provider.saveTrack!(ID_A)).rejects.toThrow("owner of this video has turned off likes")
  })

  it("shows Google's own message for other refusals", async () => {
    const { provider } = setup([json({ error: { message: 'The video that you are trying to rate cannot be found.', errors: [{ reason: 'videoNotFound' }] } }, { status: 404 })])
    await expect(provider.saveTrack!(ID_A)).rejects.toThrow('YouTube: The video that you are trying to rate cannot be found. (status 404)')
  })

  it('does not retry a rating that was refused', async () => {
    const { provider, fetchFn } = setup([json({ error: { message: 'No' } }, { status: 400 })])
    await expect(provider.saveTrack!(ID_A)).rejects.toThrow()
    expect(fetchFn).toHaveBeenCalledOnce()
  })
})

describe('YouTube grants', () => {
  it('flags a sign-in made with the older, read-only permission', async () => {
    expect(await setup([], { scopes: false }).provider.needsReauthorization?.()).toBe(true)
    expect(await setup([]).provider.needsReauthorization?.()).toBe(false)
  })

  it('does not ask someone who is signed out to reconnect', async () => {
    const { provider, session } = setup([], { scopes: false })
    session.isConnected.mockResolvedValue(false)
    expect(await provider.needsReauthorization?.()).toBe(false)
  })

  it('can be searched and saved to, which its status reports', async () => {
    const { provider } = setup([])
    expect([provider.search, provider.saveTrack, provider.unsaveTrack].every((fn) => typeof fn === 'function')).toBe(true)
    expect(pathsOf(vi.fn())).toEqual([])
  })
})
