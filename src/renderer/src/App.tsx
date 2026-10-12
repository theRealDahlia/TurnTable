import { useEffect, useState } from 'react'
import { LegalDialog } from './components/LegalDialog'
import { PlayerBar } from './components/PlayerBar'
import { TermsGate } from './components/TermsGate'
import { useAcceptance } from './legal/useAcceptance'
import { Sidebar, type Page } from './components/Sidebar'
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
  // A song saved or removed from Search changes the library by that one song, with no need to fetch it all again.
  const { noteSaved } = library
  const search = useSearch({ onSaved: noteSaved })
  useMediaSession(player)
  useMediaKeys(player)
  useSpacebarToggle(player.toggle)

  // A service's content must not outlive its connection, so the player lets go of a track whose service was disconnected.
  const playingFrom = player.track?.providerId
  const { clear } = player
  useEffect(() => {
    if (playingFrom && library.providers.some((provider) => provider.id === playingFrom && !provider.connected)) clear()
  }, [playingFrom, library.providers, clear])

  const navigate = (next: Page): void => setPage(next)

  return (
    <div className="app" data-playing={player.track !== undefined}>
      <div className="drag-strip" aria-hidden="true" />
      <Sidebar page={page} onNavigate={navigate} onOpenLegal={() => setLegalOpen(true)}>
        <YouTubePanel track={player.track} />
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
