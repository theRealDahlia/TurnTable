import { describe, expect, it } from 'vitest'
import { isPlayable, playbackUrl, spotifyTrackIdFromUri, unplayableReason } from '../src/shared/media'

const SPOTIFY_ID = '4iV5W9uYEdYUVa79Axb7Rh'
const LOCAL_ID = 'a'.repeat(24)

describe('spotifyTrackIdFromUri', () => {
  it('extracts the id from a track URI', () => {
    expect(spotifyTrackIdFromUri(`spotify:track:${SPOTIFY_ID}`)).toBe(SPOTIFY_ID)
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

  it.each([
    ['a Spotify track with a malformed id', { id: 'spotify-1', providerId: 'spotify' as const, quality: undefined }],
    ['a Spotify id that could alter a URI', { id: `${SPOTIFY_ID.slice(0, 18)}:../`, providerId: 'spotify' as const, quality: undefined }],
    ['an ALAC file', { id: LOCAL_ID, providerId: 'local' as const, quality: { codec: 'alac', lossless: true } }],
    ['a local file of unknown format', { id: LOCAL_ID, providerId: 'local' as const, quality: undefined }],
    ['a track from a service without playback', { id: LOCAL_ID, providerId: 'qobuz' as const, quality: { codec: 'flac', lossless: true } }]
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
    expect(unplayableReason({ providerId: 'qobuz', quality: undefined })).toMatch(/not available yet/)
  })
})
