import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { describeError } from '@shared/errors'
import type { Track } from '@shared/types'
import type { VideoSize } from '../lib/useVideoSize'
import { videoHeight } from '../lib/videoSize'
import { youtubeBridge, type YouTubeBridge } from '../player/YouTubeBridge'

/** Pixels one arrow-key press or one size button changes the width by, and the larger step with Shift. */
const STEP = 24
const BIG_STEP = 96
const BUTTON_STEP = 48
const ASPECT_RATIO = 16 / 9

interface Props {
  /** What is playing; the panel shows while it is a YouTube Music track. */
  track?: Track
  size: VideoSize
  bridge?: YouTubeBridge
}

/**
 * YouTube only lets its videos play in its own embedded player, and that player has to be on screen, so
 * YouTube Music tracks play in this small window. It is created the first time a YouTube track is played
 * and stays mounted, hidden while anything else plays.
 */
export function YouTubePanel({ track, size, bridge = youtubeBridge }: Props): React.JSX.Element | null {
  const requested = useSyncExternalStore(bridge.subscribe, bridge.isRequested)
  const [url, setUrl] = useState<string>()
  const [problem, setProblem] = useState<string>()
  const frame = useRef<HTMLIFrameElement>(null)
  const drag = useRef<{ x: number; y: number; width: number }>(undefined)
  const [resizing, setResizing] = useState(false)

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
  const height = videoHeight(size.width)

  // The window is anchored bottom-right, so pulling the top-left corner up or left makes it bigger.
  const startResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, width: size.width }
    setResizing(true)
  }
  const moveResize = (event: React.PointerEvent<HTMLDivElement>): void => {
    const start = drag.current
    if (!start) return
    const byX = start.x - event.clientX
    const byY = (start.y - event.clientY) * ASPECT_RATIO
    // Follow whichever way the pointer is being pulled more, so a diagonal drag feels natural.
    size.set(start.width + (Math.abs(byX) >= Math.abs(byY) ? byX : byY))
  }
  const endResize = (): void => {
    drag.current = undefined
    setResizing(false)
  }
  const keyResize = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? BIG_STEP : STEP
    const changes: Record<string, number> = {
      ArrowUp: size.width + step,
      ArrowLeft: size.width + step,
      ArrowDown: size.width - step,
      ArrowRight: size.width - step,
      Home: size.min,
      End: size.max
    }
    const next = changes[event.key]
    if (next === undefined) return
    event.preventDefault()
    size.set(next)
  }

  return (
    <aside
      className="youtube-panel"
      data-showing={showing}
      data-resizing={resizing}
      aria-label="YouTube video"
      aria-hidden={!showing}
      style={{ width: size.width }}
    >
      <div
        className="youtube-resize"
        role="slider"
        tabIndex={showing ? 0 : -1}
        aria-label="Video size. Arrow up or left to enlarge, down or right to shrink."
        aria-orientation="horizontal"
        aria-valuemin={size.min}
        aria-valuemax={size.max}
        aria-valuenow={size.width}
        aria-valuetext={`${size.width} by ${height} pixels`}
        title="Drag to resize; double-click to reset"
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onLostPointerCapture={endResize}
        onDoubleClick={size.reset}
        onKeyDown={keyResize}
      />
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
        <span className="youtube-credit-actions">
          {track?.url && showing && (
            <a href={track.url} target="_blank" rel="noreferrer">
              Open on YouTube Music
            </a>
          )}
          <button type="button" aria-label="Smaller video" disabled={size.width <= size.min} onClick={() => size.set(size.width - BUTTON_STEP)}>
            −
          </button>
          <button type="button" aria-label="Larger video" disabled={size.width >= size.max} onClick={() => size.set(size.width + BUTTON_STEP)}>
            +
          </button>
        </span>
      </footer>
    </aside>
  )
}
