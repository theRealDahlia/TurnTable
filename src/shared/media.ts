/** Custom scheme the main process serves local audio and artwork on; the renderer never sees file paths. */
export const MEDIA_SCHEME = 'turntable-media'

export type MediaKind = 'audio' | 'art'

export function mediaUrl(kind: MediaKind, id: string): string {
  return `${MEDIA_SCHEME}://${kind}/${id}`
}
