import { describe, expect, it } from 'vitest'
import { isPlayable, playbackUrl, spotifyTrackIdFromUri, tidalTrackIdFromSource, unplayableReason } from '../src/shared/media'

const SPOTIFY_ID = '4iV5W9uYEdYUVa79Axb7Rh'
const LOCAL_ID = 'a'.repeat(24)

describe('spotifyTrackIdFromUri', () => {
  it('extracts the id from a track URI', () => {
    expect(spotifyTrackIdFromUri(`spotify:track:${SPOTIFY_ID}`)).toBe(SPOTIFY_ID)
  })

  it('plays a TIDAL track through its id, and nothing that could alter a command', () => {
    expect(playbackUrl({ id: '4321', providerId: 'tidal', quality: undefined })).toBe('tidal:4321')
    for (const id of ['', 'a/b', 'a b', 'x'.repeat(65), 'a:b']) expect(playbackUrl({ id, providerId: 'tidal', quality: undefined })).toBeUndefined()
    expect(playbackUrl({ id: '4321', providerId: 'tidal', quality: undefined, playable: false })).toBeUndefined()
    expect(tidalTrackIdFromSource('tidal:4321')).toBe('4321')
    expect(tidalTrackIdFromSource('spotify:track:4321')).toBeUndefined()
    expect(tidalTrackIdFromSource('tidal:')).toBeUndefined()
    expect(unplayableReason({ providerId: 'tidal', quality: undefined, playable: false })).toMatch(/TIDAL doesn't stream this track/)
  })

  it.each(['', 'spotify:track:', 'spotify:track:short', `spotify:album:${SPOTIFY_ID}`, `spotify:track:${SPOTIFY_ID}x`, `spotify:track:${SPOTIFY_ID}\n`, SPOTIFY_ID, `turntable-media://audio/${LOCAL_ID}`])(
    'rejects %j',
    (uri) => {
      expect(spotifyTrackIdFromUri(uri)).toBeUndefined()
    }
  )
})

describe('playbackUrl', () => {
  it('plays a Spotify track through its URI', () => {
    expect(playbackUrl({ id: SPOTIFY_ID, providerId: 'spotify', quality: undefined })).toBe(`spotify:track:${SPOTIFY_ID}`)
  })

  it('plays a decodable local file through the private media address', () => {
    expect(playbackUrl({ id: LOCAL_ID, providerId: 'local', quality: { codec: 'flac', lossless: true } })).toBe(`turntable-media://audio/${LOCAL_ID}`)
  })

  it('plays a YouTube track through its video id', () => {
    expect(playbackUrl({ id: 'abcdefghijk', providerId: 'youtubeMusic', quality: undefined })).toBe('youtube:abcdefghijk')
  })

  it.each([
    ['a YouTube track with a malformed id', { id: 'short', providerId: 'youtubeMusic' as const, quality: undefined }],
    ['a YouTube id that could alter a URL', { id: 'abc/def?ghi', providerId: 'youtubeMusic' as const, quality: undefined }],
    ['a YouTube video that cannot be embedded', { id: 'abcdefghijk', providerId: 'youtubeMusic' as const, quality: undefined, playable: false }],
    ['a Spotify track the service marked unplayable', { id: SPOTIFY_ID, providerId: 'spotify' as const, quality: undefined, playable: false }],
    ['a Spotify track with a malformed id', { id: 'spotify-1', providerId: 'spotify' as const, quality: undefined }],
    ['a Spotify id that could alter a URI', { id: `${SPOTIFY_ID.slice(0, 18)}:../`, providerId: 'spotify' as const, quality: undefined }],
    ['an ALAC file', { id: LOCAL_ID, providerId: 'local' as const, quality: { codec: 'alac', lossless: true } }],
    ['a local file of unknown format', { id: LOCAL_ID, providerId: 'local' as const, quality: undefined }]
  ])('has nothing to play for %s', (_label, track) => {
    expect(playbackUrl(track)).toBeUndefined()
    expect(isPlayable(track)).toBe(false)
  })
})

describe('unplayableReason', () => {
  it('explains each kind of refusal', () => {
    expect(unplayableReason({ providerId: 'local', quality: { codec: 'alac', lossless: true } })).toMatch(/ALAC files can't be played/)
    expect(unplayableReason({ providerId: 'local', quality: undefined })).toMatch(/can't be played/)
    expect(unplayableReason({ providerId: 'spotify', quality: undefined })).toMatch(/Spotify track can't be played/)
    expect(unplayableReason({ providerId: 'youtubeMusic', quality: undefined, playable: false })).toMatch(/owner .* outside YouTube/)
    expect(unplayableReason({ providerId: 'tidal', quality: undefined, playable: false })).toMatch(/TIDAL doesn't stream this track/)
  })
})
