import { useState } from 'react'
import { Sidebar, type Page } from './components/Sidebar'
import { useLibrary } from './library/useLibrary'
import { ConnectionsPage } from './pages/ConnectionsPage'
import { LibraryPage } from './pages/LibraryPage'

export function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>('library')
  // Owned here so the library loads once and survives switching pages.
  const library = useLibrary()

  return (
    <div className="app">
      <Sidebar page={page} onNavigate={setPage} />
      {page === 'library' ? (
        <LibraryPage library={library} onOpenConnections={() => setPage('connections')} />
      ) : (
        <ConnectionsPage onChanged={library.reload} />
      )}
    </div>
  )
}
