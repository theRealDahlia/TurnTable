import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { describeError } from '@shared/errors'
import type { Track } from '@shared/types'
import { youtubeBridge, type YouTubeBridge } from '../player/YouTubeBridge'

interface Props {
  /** What is playing; the panel shows while it is a YouTube Music track. */
  track?: Track
  bridge?: YouTubeBridge
}

/**
 * YouTube only lets its videos play in its own embedded player, and that player has to be on screen (at least
 * 200 by 200 pixels), so YouTube Music tracks play in this square at the bottom of the sidebar. It is created
 * the first time a YouTube track is played and stays mounted, hidden while anything else plays.
 */
export function YouTubePanel({ track, bridge = youtubeBridge }: Props): React.JSX.Element | null {
  const requested = useSyncExternalStore(bridge.subscribe, bridge.isRequested)
  const [url, setUrl] = useState<string>()
  const [problem, setProblem] = useState<string>()
  const frame = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!requested) return
    let cancelled = false
    window.turntableYouTube.getPlayerUrl().then(
      (found) => {
        if (!cancelled) setUrl(found)
      },
      (error: unknown) => {
        if (!cancelled) setProblem(describeError(error))
      }
    )
    return () => {
      cancelled = true
    }
  }, [requested])

  // The frame's window object outlives its page loads, so one attachment covers reloads too.
  useEffect(() => {
    const target = frame.current?.contentWindow
    if (!url || !target) return
    return bridge.attach(target, new URL(url).origin)
  }, [bridge, url])

  if (!requested) return null
  const showing = track?.providerId === 'youtubeMusic'

  return (
    <aside className="youtube-panel" data-showing={showing} aria-label="YouTube video" aria-hidden={!showing}>
      {url ? (
        <iframe
          ref={frame}
          className="youtube-frame"
          src={url}
          title="YouTube player"
          allow="autoplay; encrypted-media"
          // Scripts and the page's own origin are what the player needs; no navigating the app, no forms.
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
        />
      ) : (
        <p className="youtube-note">{problem ?? 'Loading YouTube…'}</p>
      )}
      <footer className="youtube-credit">
        <span>Video from YouTube</span>
        {track?.url && showing && (
          <a href={track.url} target="_blank" rel="noreferrer">
            Open on YouTube Music
          </a>
        )}
      </footer>
    </aside>
  )
}
