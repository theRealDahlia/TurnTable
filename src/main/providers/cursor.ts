/** Cursors come from the renderer, so only accept the plain offsets a provider would have issued. */
export function parseOffsetCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  if (!/^\d{1,9}$/.test(cursor)) throw new Error('Invalid library cursor')
  return Number(cursor)
}
