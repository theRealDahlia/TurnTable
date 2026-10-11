import { join } from 'node:path'
import { ipcMain } from 'electron'
import { YOUTUBE_PLAYER_PAGE, YouTubePlayerChannel } from '@shared/youtubePlayer'
import { startPlayerServer, type PlayerServer } from './server'

/**
 * Tells the app window where to load YouTube's player page from. While developing, the dev server already
 * serves it from `localhost`, which YouTube accepts; the packaged app serves it from a loopback server.
 */
export function registerYouTubePlayer(): { close(): void } {
  let server: Promise<PlayerServer> | undefined

  ipcMain.handle(YouTubePlayerChannel.playerUrl, async () => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) return `${devUrl}/${YOUTUBE_PLAYER_PAGE}`
    server ??= startPlayerServer(join(__dirname, '../renderer'))
    return (await server).url
  })

  return { close: () => void server?.then((started) => started.close()) }
}
