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

/** The URL the player should load for a track, or undefined if TurnTable can't play it (yet). */
export function playbackUrl(track: Pick<Track, 'id' | 'providerId' | 'quality'>): string | undefined {
  if (track.providerId !== 'local') return undefined
  return track.quality && PLAYABLE_LOCAL_CODECS.has(track.quality.codec) ? mediaUrl('audio', track.id) : undefined
}

export const isPlayable = (track: Pick<Track, 'id' | 'providerId' | 'quality'>): boolean => playbackUrl(track) !== undefined

/** Why a track has no Play button, for the tooltip. */
export function unplayableReason(track: Pick<Track, 'providerId' | 'quality'>): string {
  if (track.providerId === 'local') {
    return track.quality ? `${track.quality.codec.toUpperCase()} files can't be played in TurnTable yet` : "This file can't be played"
  }
  return 'Playback for this service is not available yet'
}
