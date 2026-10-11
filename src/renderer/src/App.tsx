import { useRef, useState } from 'react'
import { PlayerBar } from './components/PlayerBar'
import { Sidebar, type Page } from './components/Sidebar'
import { YouTubePanel } from './components/YouTubePanel'
import { useLibrary } from './library/useLibrary'
import { ConnectionsPage } from './pages/ConnectionsPage'
import { LibraryPage } from './pages/LibraryPage'
import { SearchPage } from './pages/SearchPage'
import { useMediaSession } from './player/useMediaSession'
import { usePlayer } from './player/usePlayer'
import { useSpacebarToggle } from './player/useSpacebarToggle'
import { useSearch } from './search/useSearch'
import type { ProviderId } from '@shared/types'

export function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('library')
  // Owned here so the library and the player survive switching pages.
  const library = useLibrary()
  const player = usePlayer()
  // Songs saved from Search change a service's library, which the Library catches up with when it is next opened.
  const changed = useRef(new Set<ProviderId>())
  const search = useSearch({ onSaved: (id) => void changed.current.add(id) })
  useMediaSession(player)
  useSpacebarToggle(player.toggle)

  const navigate = (next: Page): void => {
    if (next === 'library') {
      for (const id of changed.current) library.refresh(id)
      changed.current.clear()
    }
    setPage(next)
  }

  return (
    <div className="app" data-playing={player.track !== undefined}>
      <div className="drag-strip" aria-hidden="true" />
      <Sidebar page={page} onNavigate={navigate}>
        <YouTubePanel track={player.track} />
      </Sidebar>
      <div className="content">
        {page === 'library' && <LibraryPage library={library} player={player} onOpenConnections={() => setPage('connections')} />}
        {page === 'search' && <SearchPage library={library} player={player} search={search} onOpenConnections={() => setPage('connections')} />}
        {page === 'connections' && <ConnectionsPage onChanged={library.refreshProvider} />}
      </div>
      <PlayerBar player={player} />
    </div>
  )
}
