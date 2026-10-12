import { join } from 'node:path'
import { ipcMain } from 'electron'
import { YOUTUBE_PLAYER_PAGE, YouTubePlayerChannel } from '@shared/youtubePlayer'
import { startPlayerServer, type PlayerServer } from './server'

/**
 * Tells the app window where to load each service's player page from. While developing, the dev server already
 * serves them from `localhost`, which the services accept; the packaged app serves them from a loopback server.
 */
export function registerEmbedPlayers(): { close(): void } {
  let server: Promise<PlayerServer> | undefined

  const urlFor = async (page: string): Promise<string> => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) return `${devUrl}/${page}`
    server ??= startPlayerServer(join(__dirname, '../renderer'))
    return (await server).urlOf(page)
  }

  ipcMain.handle(YouTubePlayerChannel.playerUrl, () => urlFor(YOUTUBE_PLAYER_PAGE))

  return { close: () => void server?.then((started) => started.close()) }
}
