import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { describeError } from '@shared/errors'
import type { ProviderId, Track } from '@shared/types'
import type { FrameHost } from '../player/EmbedBridge'

interface Props {
  /** The service whose tracks play here; the panel shows while one of them is the current track. */
  provider: ProviderId
  /** What is playing, if anything. */
  track?: Track
  bridge: FrameHost
  /** Asks the main process where the player page is served from. It must be the same function every render. */
  getPlayerUrl: () => Promise<string>
  /** Names the panel for people using assistive technology. */
  label: string
  frameTitle: string
  loadingText: string
  /** Credits the service, as its terms require. */
  credit: string
  /** The link back to the track on the service. */
  linkLabel: string
}

/**
 * Some services only let their music play in their own embedded player, and that player has to be on screen
 * (YouTube wants at least 200 by 200 pixels), so their tracks play in this square at the bottom of the sidebar.
 * It is created the first time one of the service's tracks is played and stays mounted, hidden while anything
 * else plays.
 */
export function EmbedPanel({ provider, track, bridge, getPlayerUrl, label, frameTitle, loadingText, credit, linkLabel }: Props): React.JSX.Element | null {
  const requested = useSyncExternalStore(bridge.subscribe, bridge.isRequested)
  const [url, setUrl] = useState<string>()
  const [problem, setProblem] = useState<string>()
  const frame = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!requested) return
    let cancelled = false
    getPlayerUrl().then(
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
  }, [requested, getPlayerUrl])

  // The frame's window object outlives its page loads, so one attachment covers reloads too.
  useEffect(() => {
    const target = frame.current?.contentWindow
    if (!url || !target) return
    return bridge.attach(target, new URL(url).origin)
  }, [bridge, url])

  if (!requested) return null
  const showing = track?.providerId === provider

  return (
    <aside className="embed-panel" data-showing={showing} aria-label={label} aria-hidden={!showing}>
      {url ? (
        <iframe
          ref={frame}
          className="embed-frame"
          src={url}
          title={frameTitle}
          allow="autoplay; encrypted-media"
          // Scripts and the page's own origin are what the player needs; no navigating the app, no forms.
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation"
        />
      ) : (
        <p className="embed-note">{problem ?? loadingText}</p>
      )}
      <footer className="embed-credit">
        <span>{credit}</span>
        {track?.url && showing && (
          <a href={track.url} target="_blank" rel="noreferrer">
            {linkLabel}
          </a>
        )}
      </footer>
    </aside>
  )
}
