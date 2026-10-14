import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Album, ProviderStatus } from '@shared/types'
import { artistKey, type Artist } from './artist/useArtistSongs'
import { LegalDialog } from './components/LegalDialog'
import { PlayerBar } from './components/PlayerBar'
import { TermsGate } from './components/TermsGate'
import { useAcceptance } from './legal/useAcceptance'
import { Sidebar, type Page } from './components/Sidebar'
import { YouTubePanel } from './components/YouTubePanel'
import { useLibrary } from './library/useLibrary'
import { AlbumPage } from './pages/AlbumPage'
import { ArtistPage } from './pages/ArtistPage'
import { ConnectionsPage } from './pages/ConnectionsPage'
import { LibraryPage } from './pages/LibraryPage'
import { SearchPage } from './pages/SearchPage'
import { useMediaKeys } from './player/useMediaKeys'
import { useMediaSession } from './player/useMediaSession'
import { usePlayer } from './player/usePlayer'
import { useSpacebarToggle } from './player/useSpacebarToggle'
import { useSearch } from './search/useSearch'

/** An artist's or an album's page, opened over the current page. */
type View = { kind: 'artist'; artist: Artist } | { kind: 'album'; album: Album }

const viewKey = (view: View): string => (view.kind === 'artist' ? `artist:${artistKey(view.artist)}` : `album:${view.album.providerId}:${view.album.id}`)
const viewName = (view: View): string => (view.kind === 'artist' ? view.artist.name : view.album.title)
const viewService = (view: View): Album['providerId'] => (view.kind === 'artist' ? view.artist.providerId : view.album.providerId)

/** What the Back button on an artist or album page says when it returns to a page. */
const PAGE_NAMES: Record<Page, string> = { library: 'Library', search: 'Search', connections: 'Connections' }

/** Nothing connects or loads until the user has agreed to the agreement and privacy policy. */
export function App(): React.JSX.Element {
  const { accepted, accept } = useAcceptance()
  return accepted ? <Main /> : <TermsGate onAccept={accept} />
}

function Main(): React.JSX.Element {
  const [page, setPage] = useState<Page>('library')
  const [legalOpen, setLegalOpen] = useState(false)
  // Artist and album pages open over the current page, which stays as it was underneath; Back walks back through them.
  const [views, setViews] = useState<View[]>([])
  const content = useRef<HTMLDivElement>(null)
  /** How far each level was scrolled when another opened over it: the page underneath first, then each view. */
  const scrolls = useRef<number[]>([])
  /** Where the next level to show should be scrolled to. */
  const nextScroll = useRef(0)
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
    nextScroll.current = 0
    setViews([])
    setPage(next)
  }

  const open = (view: View): void => {
    const already = views.findIndex((open) => viewKey(open) === viewKey(view))
    if (already >= 0 && already === views.length - 1) return
    // A page that is already open further back is gone back to, as it was left, rather than opened twice.
    if (already >= 0) {
      nextScroll.current = scrolls.current[already + 1] ?? 0
      setViews(views.slice(0, already + 1))
      return
    }
    scrolls.current[views.length] = content.current?.scrollTop ?? 0
    nextScroll.current = 0
    setViews([...views, view])
  }
  const openArtist = (artist: Artist): void => open({ kind: 'artist', artist })
  const openAlbum = (album: Album): void => open({ kind: 'album', album })
  const back = (): void => {
    nextScroll.current = scrolls.current[views.length - 1] ?? 0
    setViews(views.slice(0, -1))
  }

  // An artist's or album's page belongs to its service, so it goes when the service is disconnected.
  const connectedTo = (view: View): ProviderStatus | undefined => library.providers.find((provider) => provider.id === viewService(view) && provider.connected)
  const openViews = views.flatMap((view) => {
    const provider = connectedTo(view)
    return provider ? [{ view, provider }] : []
  })
  const top = openViews.at(-1)
  const showingView = top !== undefined

  // A newly opened level starts at the top; going back returns to where that level was left.
  const shownKey = top ? viewKey(top.view) : `page:${page}`
  useLayoutEffect(() => {
    if (content.current) content.current.scrollTop = nextScroll.current
  }, [shownKey])

  return (
    <div className="app" data-playing={player.track !== undefined}>
      <div className="drag-strip" aria-hidden="true" />
      <Sidebar page={page} onNavigate={navigate} onOpenLegal={() => setLegalOpen(true)}>
        <YouTubePanel track={player.track} />
      </Sidebar>
      <div className="content" ref={content}>
        <div className="page-holder" hidden={showingView}>
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
        {/* Pages under the top one stay as they were, so Back shows them again without fetching anything. */}
        {openViews.map(({ view, provider }, index) => {
          const backLabel = index > 0 ? viewName(openViews[index - 1]!.view) : PAGE_NAMES[page]
          return (
            <div key={viewKey(view)} className="page-holder" hidden={index !== openViews.length - 1}>
              {view.kind === 'artist' ? (
                <ArtistPage
                  artist={view.artist}
                  provider={provider}
                  library={library}
                  player={player}
                  backLabel={backLabel}
                  onBack={back}
                  onOpenArtist={openArtist}
                  onOpenAlbum={openAlbum}
                />
              ) : (
                <AlbumPage album={view.album} provider={provider} library={library} player={player} backLabel={backLabel} onBack={back} onOpenArtist={openArtist} />
              )}
            </div>
          )
        })}
      </div>
      <PlayerBar player={player} onOpenArtist={openArtist} />
      {legalOpen && <LegalDialog initial="PRIVACY.md" onClose={() => setLegalOpen(false)} />}
    </div>
  )
}
