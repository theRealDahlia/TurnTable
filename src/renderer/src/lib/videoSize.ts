/** YouTube requires an embedded player's viewport to be at least 200 pixels tall and wide; at 16:9 that is 356 wide. */
export const VIDEO_MIN_WIDTH = 356
export const VIDEO_DEFAULT_WIDTH = 400
const VIDEO_MAX_WIDTH = 900
const ASPECT_RATIO = 16 / 9
/** Space the video window leaves free: the sidebar and the margins around it. */
const SIDEBAR_AND_MARGINS = 232 + 40
/** Space above and below it: the player bar, its gap, the credit line and a margin at the top. */
const BAR_CREDIT_AND_MARGINS = 96 + 32 + 24

const STORAGE_KEY = 'turntable.video-width'

export const videoHeight = (width: number): number => Math.round(width / ASPECT_RATIO)

/** The widest the video can be in a window of this size without covering the sidebar or running off the top. */
export function videoMaxWidth(viewportWidth: number, viewportHeight: number): number {
  const byWidth = viewportWidth - SIDEBAR_AND_MARGINS
  const byHeight = (viewportHeight - BAR_CREDIT_AND_MARGINS) * ASPECT_RATIO
  return Math.max(VIDEO_MIN_WIDTH, Math.floor(Math.min(VIDEO_MAX_WIDTH, byWidth, byHeight)))
}

/** `width` limited to what YouTube allows and the window has room for; anything that isn't a number gives the default. */
export function clampVideoWidth(width: number, max: number): number {
  if (!Number.isFinite(width)) return Math.min(VIDEO_DEFAULT_WIDTH, max)
  return Math.round(Math.min(max, Math.max(VIDEO_MIN_WIDTH, width)))
}

type SavedStorage = Pick<Storage, 'getItem' | 'setItem'>

/** Storage can be missing, full or blocked (private windows), and none of that may break the player. */
function storage(): SavedStorage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

/** The width the user chose last time, if one was saved and still makes sense. */
export function readSavedVideoWidth(source: SavedStorage | undefined = storage()): number | undefined {
  try {
    const saved = source?.getItem(STORAGE_KEY)
    if (saved === null || saved === undefined || !/^\d{1,4}$/.test(saved)) return undefined
    return Number(saved)
  } catch {
    return undefined
  }
}

export function saveVideoWidth(width: number, target: SavedStorage | undefined = storage()): void {
  try {
    target?.setItem(STORAGE_KEY, String(Math.round(width)))
  } catch {
    // Not remembering the size is fine.
  }
}
