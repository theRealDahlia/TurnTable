import type { Track } from './types'

/** Custom scheme the main process serves local audio and artwork on; the renderer never sees file paths. */
export const MEDIA_SCHEME = 'turntable-media'

export type MediaKind = 'audio' | 'art'

export function mediaUrl(kind: MediaKind, id: string): string {
  return `${MEDIA_SCHEME}://${kind}/${id}`
}

/**
 * Local formats Chromium can decode. ALAC and AIFF are readable (tags, format) but fail to play, so
 * they are excluded; MP3, Ogg Vorbis and Opus are standard Chromium formats.
 */
const PLAYABLE_LOCAL_CODECS = new Set(['flac', 'mp3', 'aac', 'ogg-vorbis', 'opus', 'wav'])

/** Spotify ids are 22 base-62 characters. */
const SPOTIFY_TRACK_ID = /^[A-Za-z0-9]{22}$/
const SPOTIFY_URI_PREFIX = 'spotify:track:'

/** The id inside a `spotify:track:<id>` URI, or undefined if the text is anything else. */
export function spotifyTrackIdFromUri(uri: string): string | undefined {
  if (!uri.startsWith(SPOTIFY_URI_PREFIX)) return undefined
  const id = uri.slice(SPOTIFY_URI_PREFIX.length)
  return SPOTIFY_TRACK_ID.test(id) ? id : undefined
}

/** What the player should load for a track, or undefined if TurnTable can't play it (yet). */
export function playbackUrl(track: Pick<Track, 'id' | 'providerId' | 'quality'>): string | undefined {
  if (track.providerId === 'spotify') return SPOTIFY_TRACK_ID.test(track.id) ? `${SPOTIFY_URI_PREFIX}${track.id}` : undefined
  if (track.providerId !== 'local') return undefined
  return track.quality && PLAYABLE_LOCAL_CODECS.has(track.quality.codec) ? mediaUrl('audio', track.id) : undefined
}

export const isPlayable = (track: Pick<Track, 'id' | 'providerId' | 'quality'>): boolean => playbackUrl(track) !== undefined

/** Why a track has no Play button, for the tooltip. */
export function unplayableReason(track: Pick<Track, 'providerId' | 'quality'>): string {
  if (track.providerId === 'local') {
    return track.quality ? `${track.quality.codec.toUpperCase()} files can't be played in TurnTable yet` : "This file can't be played"
  }
  if (track.providerId === 'spotify') return "This Spotify track can't be played"
  return 'Playback for this service is not available yet'
}
