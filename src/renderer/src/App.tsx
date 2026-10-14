import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { artistKey, type Artist } from './artist/useArtistSongs'
import { LegalDialog } from './components/LegalDialog'
import { PlayerBar } from './components/PlayerBar'
import { TermsGate } from './components/TermsGate'
import { useAcceptance } from './legal/useAcceptance'
import { Sidebar, type Page } from './components/Sidebar'
import { YouTubePanel } from './components/YouTubePanel'
import { useLibrary } from './library/useLibrary'
import { ArtistPage } from './pages/ArtistPage'
import { ConnectionsPage } from './pages/ConnectionsPage'
import { LibraryPage } from './pages/LibraryPage'
import { SearchPage } from './pages/SearchPage'
import { useMediaKeys } from './player/useMediaKeys'
import { useMediaSession } from './player/useMediaSession'
import { usePlayer } from './player/usePlayer'
import { useSpacebarToggle } from './player/useSpacebarToggle'
import { useSearch } from './search/useSearch'

/** What the Back button on an artist page says when it returns to a page. */
const PAGE_NAMES: Record<Page, string> = { library: 'Library', search: 'Search', connections: 'Connections' }

/** Nothing connects or loads until the user has agreed to the agreement and privacy policy. */
export function App(): React.JSX.Element {
  const { accepted, accept } = useAcceptance()
  return accepted ? <Main /> : <TermsGate onAccept={accept} />
}

function Main(): React.JSX.Element {
  const [page, setPage] = useState<Page>('library')
  const [legalOpen, setLegalOpen] = useState(false)
  // Artist pages open over the current page, which stays as it was underneath; Back walks back through them.
  const [artists, setArtists] = useState<Artist[]>([])
  const content = useRef<HTMLDivElement>(null)
  /** Where the page underneath was scrolled to when the first artist opened. */
  const pageScroll = useRef(0)
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

  const navigate = (next: Page): void => {
    setArtists([])
    setPage(next)
  }

  const openArtist = (artist: Artist): void => {
    const top = artists.at(-1)
    if (top && artistKey(top) === artistKey(artist)) return
    if (!top) pageScroll.current = content.current?.scrollTop ?? 0
    setArtists([...artists, artist])
  }
  const back = (): void => setArtists(artists.slice(0, -1))

  // An artist's page belongs to its service, so it goes when the service is disconnected.
  const top = artists.at(-1)
  const topProvider = top && library.providers.find((provider) => provider.id === top.providerId && provider.connected)
  const showingArtist = top !== undefined && topProvider !== undefined
  const below = artists.at(-2)

  // Each artist page opens at the top; closing the last one returns the page underneath to where it was.
  const shownKey = showingArtist ? artistKey(top) : undefined
  useLayoutEffect(() => {
    if (content.current) content.current.scrollTop = shownKey ? 0 : pageScroll.current
  }, [shownKey])

  return (
    <div className="app" data-playing={player.track !== undefined}>
      <div className="drag-strip" aria-hidden="true" />
      <Sidebar page={page} onNavigate={navigate} onOpenLegal={() => setLegalOpen(true)}>
        <YouTubePanel track={player.track} />
      </Sidebar>
      <div className="content" ref={content}>
        <div className="page-holder" hidden={showingArtist}>
          {page === 'library' && <LibraryPage library={library} player={player} onOpenConnections={() => navigate('connections')} onOpenArtist={openArtist} />}
          {page === 'search' && <SearchPage library={library} player={player} search={search} onOpenConnections={() => navigate('connections')} onOpenArtist={openArtist} />}
          {page === 'connections' && <ConnectionsPage
              onChanged={(id) => {
                library.refreshProvider(id)
                // A service's content must not outlive its connection, so its search results go too.
                search.forget(id)
              }}
            />}
        </div>
        {showingArtist && (
          <ArtistPage
            key={shownKey}
            artist={top}
            provider={topProvider}
            library={library}
            player={player}
            backLabel={below ? below.name : PAGE_NAMES[page]}
            onBack={back}
            onOpenArtist={openArtist}
          />
        )}
      </div>
      <PlayerBar player={player} onOpenArtist={openArtist} />
      {legalOpen && <LegalDialog initial="PRIVACY.md" onClose={() => setLegalOpen(false)} />}
    </div>
  )
}
