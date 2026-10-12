import { ipcMain } from 'electron'
import { QobuzChannel } from '@shared/qobuz'
import type { QobuzProvider } from './provider'

/** Lets the app window ask where to stream a Qobuz track from; the request is signed here, with the secret. */
export function registerQobuzStreaming(provider: QobuzProvider): void {
  ipcMain.handle(QobuzChannel.streamUrl, (_event, trackId: unknown) => {
    if (typeof trackId !== 'string') throw new Error('That is not a valid Qobuz track.')
    return provider.getStreamUrl(trackId)
  })
}
