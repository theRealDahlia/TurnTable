import { useRef, useState } from 'react'
import { LegalDialog } from './components/LegalDialog'
import { PlayerBar } from './components/PlayerBar'
import { TermsGate } from './components/TermsGate'
import { useAcceptance } from './legal/useAcceptance'
import { Sidebar, type Page } from './components/Sidebar'
import { SoundCloudPanel } from './components/SoundCloudPanel'
import { YouTubePanel } from './components/YouTubePanel'
import { useLibrary } from './library/useLibrary'
import { ConnectionsPage } from './pages/ConnectionsPage'
import { LibraryPage } from './pages/LibraryPage'
import { SearchPage } from './pages/SearchPage'
import { useMediaKeys } from './player/useMediaKeys'
import { useMediaSession } from './player/useMediaSession'
import { usePlayer } from './player/usePlayer'
import { useSpacebarToggle } from './player/useSpacebarToggle'
import { useSearch } from './search/useSearch'
import type { ProviderId } from '@shared/types'

/** Nothing connects or loads until the user has agreed to the agreement and privacy policy. */
export function App(): React.JSX.Element {
  const { accepted, accept } = useAcceptance()
  return accepted ? <Main /> : <TermsGate onAccept={accept} />
}

function Main(): React.JSX.Element {
  const [page, setPage] = useState<Page>('library')
  const [legalOpen, setLegalOpen] = useState(false)
  // Owned here so the library and the player survive switching pages.
  const library = useLibrary()
  const player = usePlayer()
  // Songs saved from Search change a service's library, which the Library catches up with when it is next opened.
  const changed = useRef(new Set<ProviderId>())
  const search = useSearch({ onSaved: (id) => void changed.current.add(id) })
  useMediaSession(player)
  useMediaKeys(player)
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
      <Sidebar page={page} onNavigate={navigate} onOpenLegal={() => setLegalOpen(true)}>
        <YouTubePanel track={player.track} />
        <SoundCloudPanel track={player.track} />
      </Sidebar>
      <div className="content">
        {page === 'library' && <LibraryPage library={library} player={player} onOpenConnections={() => setPage('connections')} />}
        {page === 'search' && <SearchPage library={library} player={player} search={search} onOpenConnections={() => setPage('connections')} />}
        {page === 'connections' && <ConnectionsPage
            onChanged={(id) => {
              library.refreshProvider(id)
              // A service's content must not outlive its connection, so its search results go too.
              search.forget(id)
            }}
          />}
      </div>
      <PlayerBar player={player} />
      {legalOpen && <LegalDialog initial="PRIVACY.md" onClose={() => setLegalOpen(false)} />}
    </div>
  )
}
