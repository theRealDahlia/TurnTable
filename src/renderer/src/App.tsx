import { useState } from 'react'
import { PlayerBar } from './components/PlayerBar'
import { Sidebar, type Page } from './components/Sidebar'
import { YouTubePanel } from './components/YouTubePanel'
import { useVideoSize } from './lib/useVideoSize'
import { videoHeight } from './lib/videoSize'
import { useLibrary } from './library/useLibrary'
import { ConnectionsPage } from './pages/ConnectionsPage'
import { LibraryPage } from './pages/LibraryPage'
import { useMediaSession } from './player/useMediaSession'
import { usePlayer } from './player/usePlayer'
import { useSpacebarToggle } from './player/useSpacebarToggle'

export function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('library')
  // Owned here so the library and the player survive switching pages.
  const library = useLibrary()
  const player = usePlayer()
  const video = useVideoSize()
  useMediaSession(player)
  useSpacebarToggle(player.toggle)

  return (
    <div
      className="app"
      data-playing={player.track !== undefined}
      data-video={player.track?.providerId === 'youtubeMusic'}
      // The video window floats over the list, so the list keeps room to scroll rows out from under it.
      style={{ '--video-reserve': `${videoHeight(video.width) + 32 + 96 + 24}px` } as React.CSSProperties}
    >
      <div className="drag-strip" aria-hidden="true" />
      <Sidebar page={page} onNavigate={setPage} />
      <div className="content">
        {page === 'library' ? (
          <LibraryPage library={library} player={player} onOpenConnections={() => setPage('connections')} />
        ) : (
          <ConnectionsPage onChanged={library.refreshProvider} />
        )}
      </div>
      <YouTubePanel track={player.track} size={video} />
      <PlayerBar player={player} />
    </div>
  )
}
