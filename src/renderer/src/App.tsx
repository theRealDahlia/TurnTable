import { useEffect, useState } from 'react'
import type { ProviderStatus } from '@shared/types'

/** Electron prefixes errors thrown in IPC handlers with transport details the user doesn't need. */
function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']*': (?:\w+: )?/, '')
}

export function App(): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderStatus[]>([])
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
    return () => {
      cancelled = true
    }
  }, [reloadCount])

  const toggle = async (provider: ProviderStatus): Promise<void> => {
    setError(undefined)
    try {
      if (provider.connected) await window.turntable.disconnectProvider(provider.id)
      else await window.turntable.connectProvider(provider.id)
      setReloadCount((count) => count + 1)
    } catch (e) {
      setError(describeError(e))
    }
  }

  return (
    <main>
      <h1>TurnTable</h1>
      <p>Connect your streaming services to see every saved track in one place.</p>
      {error && <p role="alert">{error}</p>}
      <ul>
        {providers.map((provider) => (
          <li key={provider.id}>
            <span>{provider.name}</span>
            <button onClick={() => void toggle(provider)}>{provider.connected ? 'Disconnect' : 'Connect'}</button>
          </li>
        ))}
      </ul>
    </main>
  )
}
