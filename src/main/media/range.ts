export interface ByteRange {
  start: number
  /** Inclusive, as in the HTTP Content-Range header. */
  end: number
}

/**
 * Parses a single-range `Range: bytes=…` header against a file of `size` bytes.
 * Returns undefined when there is no (usable) Range header, and 'unsatisfiable' when the range is
 * malformed or lies outside the file. Multi-range requests are treated as unsatisfiable, since
 * media players only ever ask for one range.
 */
export function parseByteRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | undefined {
  if (header === null) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (match[1] === '' && match[2] === '')) return 'unsatisfiable'

  if (match[1] === '') {
    // Suffix range: the last N bytes.
    const length = Number(match[2])
    if (length === 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - length), end: size - 1 }
  }

  const start = Number(match[1])
  if (start >= size) return 'unsatisfiable'
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  return end < start ? 'unsatisfiable' : { start, end }
}
