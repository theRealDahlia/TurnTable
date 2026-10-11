/** Electron prefixes errors thrown in IPC handlers with transport details the user doesn't need. */
export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']*': (?:\w+: )?/, '')
}
