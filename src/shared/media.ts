import type { Track } from './types'
import { YOUTUBE_VIDEO_ID } from './youtubePlayer'

import { APP_NAME } from './app'

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

/** TIDAL's ids are opaque, so only the plain ones that are safe to put in a URL or a command are accepted. */
const TIDAL_TRACK_ID = /^[A-Za-z0-9_-]{1,64}$/

/** The id inside a `tidal:<id>` source, or undefined if the text is anything else. */
export function tidalTrackIdFromSource(src: string): string | undefined {
  if (!src.startsWith('tidal:')) return undefined
  const id = src.slice('tidal:'.length)
  return TIDAL_TRACK_ID.test(id) ? id : undefined
}

type PlayableFacts = Pick<Track, 'id' | 'providerId' | 'quality' | 'playable'>

/** What the player should load for a track, or undefined if the app can't play it (yet). */
export function playbackUrl(track: PlayableFacts): string | undefined {
  if (track.playable === false) return undefined
  if (track.providerId === 'spotify') return SPOTIFY_TRACK_ID.test(track.id) ? `${SPOTIFY_URI_PREFIX}${track.id}` : undefined
  if (track.providerId === 'youtubeMusic') return YOUTUBE_VIDEO_ID.test(track.id) ? `youtube:${track.id}` : undefined
  if (track.providerId === 'tidal') return TIDAL_TRACK_ID.test(track.id) ? `tidal:${track.id}` : undefined
  if (track.providerId === 'qobuz') return /^\d{1,12}$/.test(track.id) ? `qobuz:${track.id}` : undefined
  if (track.providerId !== 'local') return undefined
  return track.quality && PLAYABLE_LOCAL_CODECS.has(track.quality.codec) ? mediaUrl('audio', track.id) : undefined
}

export const isPlayable = (track: PlayableFacts): boolean => playbackUrl(track) !== undefined

/** Why a track has no Play button, for the tooltip. */
export function unplayableReason(track: Pick<Track, 'providerId' | 'quality' | 'playable' | 'madeForKids'>): string {
  if (track.providerId === 'youtubeMusic' && track.madeForKids) return `YouTube marks this video as made for kids, and ${APP_NAME} can't switch off tracking in its player, which YouTube's rules require for those videos`
  if (track.providerId === 'youtubeMusic') return "The owner of this video doesn't allow it to be played outside YouTube"
  if (track.providerId === 'tidal' && track.playable === false) return "TIDAL doesn't stream this track (it may not be available for streaming in your country)"
  if (track.providerId === 'qobuz' && track.playable === false) return "Qobuz doesn't stream this track to this account (it may need a streaming subscription)"

  if (track.providerId === 'local') {
    return track.quality ? `${track.quality.codec.toUpperCase()} files can't be played in ${APP_NAME} yet` : "This file can't be played"
  }
  if (track.providerId === 'spotify') return "This Spotify track can't be played"
  return 'Playback for this service is not available yet'
}
