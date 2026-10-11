/** The message of anything that was thrown, without relying on `instanceof` (which fails across realms). */
function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  return String(error)
}

/** Electron prefixes errors thrown in IPC handlers with transport details the user doesn't need. */
export function describeError(error: unknown): string {
  return messageOf(error).replace(/^Error invoking remote method '[^']*': (?:\w+: )?/, '')
}

/** Starting a new load aborts the previous play() request, which is expected and not a failure. */
export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}
