import { useCallback, useEffect, useState } from 'react'
import { VIDEO_DEFAULT_WIDTH, VIDEO_MIN_WIDTH, clampVideoWidth, readSavedVideoWidth, saveVideoWidth, videoMaxWidth } from './videoSize'

export interface VideoSize {
  /** Current width in pixels, within `min` and `max`. */
  width: number
  min: number
  /** Depends on the window, so it changes as the window is resized. */
  max: number
  /** Sets the width (limited to `min`..`max`) and remembers it. */
  set(width: number): void
  reset(): void
}

/** How wide the YouTube video window is: the user's choice, remembered, and always one that fits the window. */
export function useVideoSize(): VideoSize {
  const [chosen, setChosen] = useState(() => readSavedVideoWidth() ?? VIDEO_DEFAULT_WIDTH)
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))

  useEffect(() => {
    const onResize = (): void => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const max = videoMaxWidth(viewport.width, viewport.height)
  // A shrunken window squeezes the video without forgetting what the user picked.
  const width = clampVideoWidth(chosen, max)

  const set = useCallback(
    (next: number) => {
      const clamped = clampVideoWidth(next, max)
      setChosen(clamped)
      saveVideoWidth(clamped)
    },
    [max]
  )
  const reset = useCallback(() => set(VIDEO_DEFAULT_WIDTH), [set])

  return { width, min: VIDEO_MIN_WIDTH, max, set, reset }
}
