import { describe, expect, it, vi } from 'vitest'
import { AuthRequiredError, type OAuthSession } from '../src/main/auth/session'
import { createSoundCloudProvider, cursorFromNextHref, toTrack } from '../src/main/providers/soundcloud/provider'

const json = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })

const item = (n: number, overrides: Record<string, unknown> = {}) => ({
  urn: `soundcloud:tracks:${n}`,
  title: `Track ${n}`,
  duration: 215_000,
  artwork_url: `https://i1.sndcdn.com/artworks-abc${n}-large.jpg`,
  permalink_url: `https://soundcloud.com/some-artist/track-${n}`,
  access: 'playable',
  user: { username: 'Some Artist', avatar_url: 'https://i1.sndcdn.com/avatars-x-large.jpg' },
  ...overrides
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
  const provider = createSoundCloudProvider(session as unknown as OAuthSession, { fetch: fetchFn as unknown as typeof fetch })
  return { session, fetchFn, provider }
}

const urlOf = (fetchFn: ReturnType<typeof vi.fn>, call = 0): URL => new URL((fetchFn.mock.calls[call] as [string])[0])

describe('toTrack', () => {
  it('maps a track', () => {
    expect(toTrack(item(7))).toEqual({
      id: 'soundcloud:tracks:7',
      providerId: 'soundcloud',
      title: 'Track 7',
      artists: ['Some Artist'],
      durationMs: 215_000,
      artworkUrl: 'https://i1.sndcdn.com/artworks-abc7-t300x300.jpg',
      url: 'https://soundcloud.com/some-artist/track-7'
    })
  })

  it('builds the URN from a plain id when the API sends only that', () => {
    expect(toTrack(item(7, { urn: undefined, id: 7 }))?.id).toBe('soundcloud:tracks:7')
    expect(toTrack(item(7, { urn: undefined, id: '8' }))?.id).toBe('soundcloud:tracks:8')
  })

  it.each([
    ['no id at all', { urn: undefined }],
    ['a URN of something else', { urn: 'soundcloud:users:7' }],
    ['a URN that could alter a URL', { urn: 'soundcloud:tracks:7/../../me' }],
    ['no title', { title: undefined }],
    ['an empty title', { title: '' }]
  ])('skips a track with %s', (_label, overrides) => {
    expect(toTrack(item(7, overrides))).toBeUndefined()
  })

  it('skips an empty entry', () => {
    expect(toTrack(null)).toBeUndefined()
  })

  it('prefers the credited artist over the uploader, and copes with having neither', () => {
    expect(toTrack(item(1, { metadata_artist: 'Real Artist' }))?.artists).toEqual(['Real Artist'])
    expect(toTrack(item(1, { metadata_artist: '' }))?.artists).toEqual(['Some Artist'])
    expect(toTrack(item(1, { user: null }))?.artists).toEqual([])
  })

  it('marks anything but a fully playable track as unplayable', () => {
    expect(toTrack(item(1, { access: 'playable' }))).not.toHaveProperty('playable')
    expect(toTrack(item(1, { access: 'preview' }))?.playable).toBe(false)
    expect(toTrack(item(1, { access: 'blocked' }))?.playable).toBe(false)
    expect(toTrack(item(1, { access: undefined }))).not.toHaveProperty('playable')
  })

  it('marks a track whose uploader does not allow embedding as unplayable, since only SoundCloud\'s own player can play it', () => {
    expect(toTrack(item(1, { embeddable_by: 'all' }))).not.toHaveProperty('playable')
    expect(toTrack(item(1, { embeddable_by: 'me' }))?.playable).toBe(false)
    expect(toTrack(item(1, { embeddable_by: 'none' }))?.playable).toBe(false)
    expect(toTrack(item(1, { embeddable_by: undefined }))).not.toHaveProperty('playable')
    expect(toTrack(item(1, { access: 'preview', embeddable_by: 'all' }))?.playable).toBe(false)
  })

  it('uses the uploader\'s picture when the track has no artwork, and no picture when there is neither', () => {
    expect(toTrack(item(1, { artwork_url: null }))?.artworkUrl).toBe('https://i1.sndcdn.com/avatars-x-t300x300.jpg')
    expect(toTrack(item(1, { artwork_url: null, user: { username: 'x', avatar_url: null } }))?.artworkUrl).toBeUndefined()
  })

  it('only passes on https artwork, and leaves a picture without a size alone', () => {
    expect(toTrack(item(1, { artwork_url: 'http://i1.sndcdn.com/a-large.jpg' }))?.artworkUrl).toBeUndefined()
    expect(toTrack(item(1, { artwork_url: 'https://i1.sndcdn.com/a.jpg' }))?.artworkUrl).toBe('https://i1.sndcdn.com/a.jpg')
    expect(toTrack(item(1, { artwork_url: 'https://i1.sndcdn.com/a-large.jpg?x=1' }))?.artworkUrl).toBe('https://i1.sndcdn.com/a-t300x300.jpg?x=1')
  })

  it('only links to SoundCloud itself', () => {
    expect(toTrack(item(1, { permalink_url: 'https://evil.example/soundcloud.com/x' }))?.url).toBeUndefined()
    expect(toTrack(item(1, { permalink_url: 'http://soundcloud.com/x' }))?.url).toBeUndefined()
    expect(toTrack(item(1, { permalink_url: undefined }))?.url).toBeUndefined()
  })

  it.each([undefined, -5, 0, '215000'])('treats a duration of %j as unknown', (duration) => {
    expect(toTrack(item(1, { duration }))?.durationMs).toBe(0)
  })
})

describe('cursorFromNextHref', () => {
  it('reads the cursor from a link to the API', () => {
    expect(cursorFromNextHref('https://api.soundcloud.com/me/likes/tracks?limit=50&cursor=1234567&linked_partitioning=true')).toBe('1234567')
  })

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['an empty link', ''],
    ['not a URL', 'cursor=123'],
    ['a link with no cursor', 'https://api.soundcloud.com/me/likes/tracks?limit=50'],
    ['a link to another host', 'https://evil.example/me/likes/tracks?cursor=123'],
    ['a plain http link', 'http://api.soundcloud.com/me/likes/tracks?cursor=123'],
    ['a cursor with characters that could alter a URL', 'https://api.soundcloud.com/x?cursor=a%26b%3D1'],
    ['a huge cursor', `https://api.soundcloud.com/x?cursor=${'a'.repeat(301)}`]
  ])('gives nothing for %s', (_label, href) => {
    expect(cursorFromNextHref(href)).toBeUndefined()
  })

  it('keeps the characters real cursors use', () => {
    expect(cursorFromNextHref('https://api.soundcloud.com/x?cursor=eyJhIjoxfQ%3D%3D')).toBe('eyJhIjoxfQ==')
    expect(cursorFromNextHref('https://api.soundcloud.com/x?cursor=1%3A2%3A3.4-5_6')).toBe('1:2:3.4-5_6')
  })
})

describe('SoundCloud getSavedTracks', () => {
  it('asks for the liked tracks with the access token, in the form SoundCloud documents', async () => {
    const { provider, fetchFn } = setup([json({ collection: [item(1)], next_href: null })])

    await provider.getSavedTracks()

    const url = urlOf(fetchFn)
    expect(`${url.origin}${url.pathname}`).toBe('https://api.soundcloud.com/me/likes/tracks')
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '50', linked_partitioning: 'true' })
    expect(fetchFn.mock.calls[0]?.[1]).toEqual({ method: 'GET', headers: { Authorization: 'OAuth token-1', Accept: 'application/json' } })
  })

  it('maps tracks and follows the cursor SoundCloud gives', async () => {
    const { provider } = setup([json({ collection: [item(1), item(2)], next_href: 'https://api.soundcloud.com/me/likes/tracks?cursor=99&limit=50' })])
    const page = await provider.getSavedTracks()
    expect(page.tracks.map((t) => t.id)).toEqual(['soundcloud:tracks:1', 'soundcloud:tracks:2'])
    expect(page.nextCursor).toBe('99')
  })

  it('sends the cursor back, and stops at the last page', async () => {
    const { provider, fetchFn } = setup([json({ collection: [item(3)], next_href: null })])
    const page = await provider.getSavedTracks('99')
    expect(urlOf(fetchFn).searchParams.get('cursor')).toBe('99')
    expect(page.nextCursor).toBeUndefined()
  })

  it('keeps paging through a page of nothing usable', async () => {
    const { provider } = setup([json({ collection: [null, item(1, { title: '' })], next_href: 'https://api.soundcloud.com/x?cursor=5' })])
    expect(await provider.getSavedTracks()).toEqual({ tracks: [], nextCursor: '5' })
  })

  it('copes with a page with no collection', async () => {
    const { provider } = setup([json({})])
    expect(await provider.getSavedTracks()).toEqual({ tracks: [], nextCursor: undefined })
  })

  it.each(['', 'a b', 'x'.repeat(301), 'c&limit=1', 'a?b', 'a#b', 'a\nb', '%2e%2e'])('refuses the cursor %j before calling SoundCloud', async (cursor) => {
    const { provider, fetchFn } = setup([])
    await expect(provider.getSavedTracks(cursor)).rejects.toThrow('Invalid library cursor')
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('SoundCloud cursors that look like base64', () => {
  it('are sent as one encoded value, never as extra parameters or path', async () => {
    const { provider, fetchFn } = setup([json({ collection: [] })])
    await provider.getSavedTracks('eyJhIjox/fQ==')
    const url = urlOf(fetchFn)
    expect(url.pathname).toBe('/me/likes/tracks')
    expect(url.searchParams.get('cursor')).toBe('eyJhIjox/fQ==')
    expect([...url.searchParams.keys()].sort()).toEqual(['cursor', 'limit', 'linked_partitioning'])
  })
})

describe('SoundCloud errors', () => {
  it('retries once with a refreshed token after a 401', async () => {
    const { provider, session, fetchFn } = setup([new Response(null, { status: 401 }), json({ collection: [item(1)] })])
    expect((await provider.getSavedTracks()).tracks).toHaveLength(1)
    expect(session.getAccessToken).toHaveBeenNthCalledWith(1, { forceRefresh: false })
    expect(session.getAccessToken).toHaveBeenNthCalledWith(2, { forceRefresh: true })
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('signs the user out and asks them to reconnect when a refreshed token is still refused', async () => {
    const { provider, session } = setup([new Response(null, { status: 401 }), new Response(null, { status: 401 })])
    const failure = provider.getSavedTracks()
    await expect(failure).rejects.toBeInstanceOf(AuthRequiredError)
    await expect(failure).rejects.toThrow(/SoundCloud session expired/)
    expect(session.disconnect).toHaveBeenCalledOnce()
  })

  it("shows SoundCloud's own message", async () => {
    const { provider } = setup([json({ code: 400, message: 'The linked_partitioning value is invalid' }, { status: 400 })])
    await expect(provider.getSavedTracks()).rejects.toThrow('SoundCloud: The linked_partitioning value is invalid (status 400)')
  })

  it.each([
    ['an errors list', { errors: [{ error_message: 'Track not found' }] }, 'SoundCloud: Track not found (status 404)'],
    ['a plain error field', { error: 'invalid_grant' }, 'SoundCloud: invalid_grant (status 404)']
  ])('reads the message from %s', async (_label, body, expected) => {
    const { provider } = setup([json(body, { status: 404 })])
    await expect(provider.getSavedTracks()).rejects.toThrow(expected)
  })

  it('explains a rate limit, with the time SoundCloud says it resets, and does not retry', async () => {
    const { provider, fetchFn } = setup([
      json({ errors: [{ meta: { rate_limit: { group: 'plays' }, reset_time: '2026/10/12 09:30:00 +0000' } }] }, { status: 429 })
    ])
    await expect(provider.getSavedTracks()).rejects.toThrow('SoundCloud is limiting requests from this app. Try again after 2026/10/12 09:30:00 +0000.')
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('explains a rate limit that gives no time, or no readable body', async () => {
    const noTime = setup([json({ message: 'slow down' }, { status: 429 })])
    await expect(noTime.provider.getSavedTracks()).rejects.toThrow('SoundCloud is limiting requests from this app. Try again later.')
    const noBody = setup([new Response('<html>', { status: 429 })])
    await expect(noBody.provider.getSavedTracks()).rejects.toThrow('SoundCloud is limiting requests from this app. Try again later.')
  })

  it('cleans up messages before showing them', async () => {
    const { provider } = setup([json({ message: `bad\u0000\n${'x'.repeat(500)}` }, { status: 400 })])
    const error = (await provider.getSavedTracks().catch((e: unknown) => e)) as Error
    expect(error.message).not.toMatch(/\p{Cc}/u)
    expect(error.message.length).toBeLessThan(260)
  })

  it.each([
    ['a body that is not JSON', new Response('<html>', { status: 500 })],
    ['an error without a message', json({ code: 500 }, { status: 500 })]
  ])('falls back to the status for %s', async (_label, response) => {
    const { provider } = setup([response])
    await expect(provider.getSavedTracks()).rejects.toThrow('SoundCloud request failed with status 500')
  })
})
