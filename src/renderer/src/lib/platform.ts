/** Whether the browser engine reports macOS, where the window has no title bar and the sidebar makes room for its buttons. */
export function isMac(userAgent: string): boolean {
  return /Macintosh|Mac OS X/.test(userAgent)
}
