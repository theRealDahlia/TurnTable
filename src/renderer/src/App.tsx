import { useState } from 'react'
import { PlayerBar } from './components/PlayerBar'
import { Sidebar, type Page } from './components/Sidebar'
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
  useMediaSession(player)
  useSpacebarToggle(player.toggle)

  return (
    <div className="app" data-playing={player.track !== undefined}>
      <Sidebar page={page} onNavigate={setPage} />
      <div className="content">
        {page === 'library' ? (
          <LibraryPage library={library} player={player} onOpenConnections={() => setPage('connections')} />
        ) : (
          <ConnectionsPage onChanged={library.reload} />
        )}
      </div>
      <PlayerBar player={player} />
    </div>
  )
}
