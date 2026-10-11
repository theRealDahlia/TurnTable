import { useEffect } from 'react'
import type { Player } from './usePlayer'

/** Lets the OS media keys, Control Center and lock screen show and control what is playing. */
export function useMediaSession(player: Player): void {
  const { track, status, toggle, pause, next, previous, seek, hasNext } = player

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const session = navigator.mediaSession

    session.metadata = track
      ? new MediaMetadata({
          title: track.title,
          artist: track.artists.join(', '),
          album: track.album ?? '',
          artwork: track.artworkUrl ? [{ src: track.artworkUrl }] : []
        })
      : null
    session.playbackState = status === 'playing' ? 'playing' : status === 'idle' ? 'none' : 'paused'
  }, [track, status])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const session = navigator.mediaSession
    const handlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      ['play', toggle],
      ['pause', pause],
      ['stop', pause],
      ['previoustrack', track ? previous : null],
      ['nexttrack', hasNext ? next : null],
      ['seekto', (details) => details.seekTime !== undefined && seek(details.seekTime)]
    ]
    for (const [action, handler] of handlers) session.setActionHandler(action, handler)
    return () => {
      for (const [action] of handlers) session.setActionHandler(action, null)
    }
  }, [toggle, pause, next, previous, seek, hasNext, track])
}
