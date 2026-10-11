/** The message of anything that was thrown, without relying on `instanceof` (which fails across realms). */
function messageOf(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') return error.message
  return String(error)
}

/** Any number of "Error invoking remote method '…': " and "SomeError: " prefixes at the start of a message. */
const TRANSPORT_PREFIX = /^(?:Error invoking remote method '[^']*':\s*|\w*Error:\s*)+/

/**
 * Electron wraps errors thrown in IPC handlers with transport details, and wraps again each time one crosses
 * another boundary. Users only need the message at the bottom of the stack.
 */
export function describeError(error: unknown): string {
  const message = messageOf(error)
  return message.replace(TRANSPORT_PREFIX, '') || message
}

/** Starting a new load aborts the previous play() request, which is expected and not a failure. */
export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}
