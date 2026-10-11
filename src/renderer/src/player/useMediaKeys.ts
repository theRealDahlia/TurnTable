import { useEffect } from 'react'
import type { MediaKeyAction } from '@shared/spotifyPlayer'
import type { Player } from './usePlayer'

/** What each keyboard media key asks the player to do. Play and pause are one key, so they are one action. */
const KEYS: Record<string, MediaKeyAction> = {
  MediaTrackNext: 'next',
  MediaTrackPrevious: 'previous',
  MediaPlayPause: 'toggle'
}

/**
 * Makes the keyboard's skip and play/pause keys drive the player, however the music is playing. The browser's
 * Media Session (see `useMediaSession`) covers the window itself; this adds the key events some keyboards
 * deliver straight to the page, and the keys that reach Spotify's hidden player when it holds the media controls.
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

    // Optional, because the bridge only exists in the real app window.
    const stopListening = (window.turntableSpotify as typeof window.turntableSpotify | undefined)?.onEvent((event) => {
      if (event.type === 'media-key') run(event.action)
    })

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      stopListening?.()
    }
  }, [track, hasNext, next, previous, toggle, pause])
}
