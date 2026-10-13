import { useEffect } from 'react'
import type { MediaKeyAction } from '@shared/spotifyPlayer'
import type { Player } from './usePlayer'

/** What each key asks the player to do. Play and pause are one key, so they are one action. */
const KEYS: Record<string, MediaKeyAction> = {
  MediaTrackNext: 'next',
  MediaTrackPrevious: 'previous',
  MediaPlayPause: 'toggle',
  // The keys that carry the skip symbols on most Mac keyboards. Pressed as plain function keys (with Fn, or when the
  // keyboard is set to use F1, F2 and so on as standard function keys) they reach the window as F7 and F9.
  F7: 'previous',
  F9: 'next'
}

/**
 * Makes the keyboard's skip and play/pause keys drive the player, however the music is playing: F7 does what the
 * Previous button does and F9 what the Next button does, and the media keys do the same where they are delivered.
 * The browser's Media Session (see `useMediaSession`) covers the system's own routing of media keys; this adds
 * the key events that reach the page directly, and the keys that reach Spotify's or TIDAL's hidden player when it holds
 * the media controls.
 */
export function useMediaKeys(player: Player): void {
  const { track, hasNext, next, previous, toggle, pause } = player

  useEffect(() => {
    const run = (action: MediaKeyAction): void => {
      if (!track) return
      if (action === 'next' && hasNext) next()
      else if (action === 'previous') previous()
      else if (action === 'toggle') toggle()
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      // Shortcuts that other things use (Cmd+F7 and the like) are not ours.
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      const action = KEYS[event.key]
      if (action) {
        event.preventDefault()
        if (!event.repeat) run(action)
      } else if (event.key === 'MediaStop') {
        event.preventDefault()
        pause()
      }
    }
    window.addEventListener('keydown', onKeyDown)

    // Optional, because the bridges only exist in the real app window.
    const stopSpotify = (window.turntableSpotify as typeof window.turntableSpotify | undefined)?.onEvent((event) => {
      if (event.type === 'media-key') run(event.action)
    })
    const stopTidal = (window.turntableTidal as typeof window.turntableTidal | undefined)?.onEvent((event) => {
      if (event.type === 'media-key') run(event.action)
    })

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      stopSpotify?.()
      stopTidal?.()
    }
  }, [track, hasNext, next, previous, toggle, pause])
}
