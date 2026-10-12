import type { AudioQuality } from './types'

/**
 * Qobuz's API Terms of Use require every application that uses the API to display this sentence prominently,
 * word for word.
 */
export const QOBUZ_NOTICE = 'This application uses the Qobuz API but is not certified by Qobuz.'


/** Where a track can be streamed from right now, and the quality of that stream. The address stops working after a while. */
export interface QobuzStream {
  url: string
  quality: AudioQuality
}

export const QobuzChannel = {
  streamUrl: 'qobuz:stream-url'
} as const

/** What the app window may ask of Qobuz for playback. The application secret that signs the request never leaves the main process. */
export interface QobuzStreamApi {
  getStreamUrl(trackId: string): Promise<QobuzStream>
}
