import { Fragment, useEffect, useState } from 'react'
import type { Credentials } from '@shared/ipc'
import { LINK_NOTICES } from '@shared/linkNotice'
import type { ProviderId, ProviderStatus } from '@shared/types'
import { CredentialsForm } from '../components/CredentialsForm'
import { ProviderChip } from '../components/ProviderChip'
import { describeError } from '@shared/errors'

interface Props {
  /** Called after a service is connected, disconnected or reconfigured, with that service, so only its data is refreshed. */
  onChanged?: (id: ProviderId) => void
}

export function ConnectionsPage({ onChanged }: Props): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<ProviderId>()
  const [error, setError] = useState<string>()
  const [reloadCount, setReloadCount] = useState(0)
  /** The service whose sign-in form is open, for services that sign in with the user's own email and password. */
  const [signingInTo, setSigningInTo] = useState<ProviderId>()
  const [formError, setFormError] = useState<string>()
  /** The service whose sign-in notice is showing, for services that want the user told what will be used before they link. */
  const [noticeFor, setNoticeFor] = useState<ProviderId>()

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

  const run = async (provider: ProviderStatus, action: 'connect' | 'disconnect'): Promise<void> => {
    setError(undefined)
    setBusyId(provider.id)
    try {
      if (action === 'disconnect') await window.turntable.disconnectProvider(provider.id)
      else await window.turntable.connectProvider(provider.id)
      setReloadCount((count) => count + 1)
      onChanged?.(provider.id)
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusyId(undefined)
    }
  }

  const signIn = async (provider: ProviderStatus, credentials: Credentials): Promise<void> => {
    setFormError(undefined)
    setBusyId(provider.id)
    try {
      await window.turntable.connectProvider(provider.id, credentials)
      setSigningInTo(undefined)
      setReloadCount((count) => count + 1)
      onChanged?.(provider.id)
    } catch (e) {
      // Shown beside the fields, where the user can fix them.
      setFormError(describeError(e))
    } finally {
      setBusyId(undefined)
    }
  }

  // Signing in again replaces an older grant that lacks the permissions the app now needs.
  const toggle = (provider: ProviderStatus): Promise<void> => {
    const signedIn = provider.connected && !provider.needsReauthorization
    // A service with an account of its own asks for the email and password first.
    if (!signedIn && provider.authKind === 'credentials') {
      setError(undefined)
      setFormError(undefined)
      setSigningInTo((current) => (current === provider.id ? undefined : provider.id))
      return Promise.resolve()
    }
    // Some services want the user told what their data is used for before they are sent to sign in.
    if (!signedIn && LINK_NOTICES[provider.id]) {
      setError(undefined)
      setNoticeFor((current) => (current === provider.id ? undefined : provider.id))
      return Promise.resolve()
    }
    return run(provider, signedIn ? 'disconnect' : 'connect')
  }
  const continueAfterNotice = (provider: ProviderStatus): void => {
    setNoticeFor(undefined)
    void run(provider, 'connect')
  }
  const addFolders = (provider: ProviderStatus): Promise<void> => run(provider, 'connect')

  const connectedCount = providers.filter((p) => p.connected).length

  return (
    <main className="page">
      <header className="page-header">
        <h1>Connections</h1>
        <p>Link your streaming services to see each one's saved tracks.</p>
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
            <Fragment key={provider.id}>
              <ProviderChip provider={provider} busy={busyId === provider.id} onToggle={toggle} onAddFolders={addFolders} />
              {noticeFor === provider.id && (
                <li className="credentials-card" aria-label={`Before linking ${provider.name}`}>
                  <p className="credentials-hint">{LINK_NOTICES[provider.id]}</p>
                  <div className="credentials-actions">
                    <button type="button" className="chip-action" disabled={busyId === provider.id} onClick={() => continueAfterNotice(provider)}>
                      Continue to {provider.name}
                    </button>
                    <button type="button" className="chip-action chip-secondary" onClick={() => setNoticeFor(undefined)}>
                      Cancel
                    </button>
                  </div>
                </li>
              )}
              {signingInTo === provider.id && (
                <li className="credentials-card">
                  <CredentialsForm
                    name={provider.name}
                    busy={busyId === provider.id}
                    error={formError}
                    onSubmit={(credentials) => void signIn(provider, credentials)}
                    onCancel={() => setSigningInTo(undefined)}
                  >
                    <p className="credentials-hint">Your email and password go only to {provider.name}, once, and are not stored. {provider.name} sends back a sign-in that stays on this computer, encrypted.</p>
                  </CredentialsForm>
                </li>
              )}
            </Fragment>
          ))}
        </ul>
      )}
    </main>
  )
}
