import { useEffect, useState } from 'react'
import type { ProviderId, ProviderStatus } from '@shared/types'
import { ProviderChip } from '../components/ProviderChip'

/** Electron prefixes errors thrown in IPC handlers with transport details the user doesn't need. */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']*': (?:\w+: )?/, '')
}

export function ConnectionsPage(): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<ProviderId>()
  const [error, setError] = useState<string>()
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    window.turntable
      .listProviders()
      .then((list) => {
        if (!cancelled) setProviders(list)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(describeError(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadCount])

  const toggle = async (provider: ProviderStatus): Promise<void> => {
    setError(undefined)
    setBusyId(provider.id)
    try {
      if (provider.connected) await window.turntable.disconnectProvider(provider.id)
      else await window.turntable.connectProvider(provider.id)
      setReloadCount((count) => count + 1)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusyId(undefined)
    }
  }

  const connectedCount = providers.filter((p) => p.connected).length

  return (
    <main className="page">
      <header className="page-header">
        <h1>Connections</h1>
        <p>Link your streaming services to see every saved track in one place.</p>
        {!loading && (
          <p className="summary" aria-live="polite">
            {connectedCount} of {providers.length} connected
          </p>
        )}
      </header>

      {error && (
        <div className="banner" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss error" onClick={() => setError(undefined)}>
            ×
          </button>
        </div>
      )}

      {loading ? (
        <p className="empty">Loading services…</p>
      ) : (
        <ul className="chips" aria-label="Streaming services">
          {providers.map((provider) => (
            <ProviderChip key={provider.id} provider={provider} busy={busyId === provider.id} onToggle={toggle} />
          ))}
        </ul>
      )}
    </main>
  )
}
