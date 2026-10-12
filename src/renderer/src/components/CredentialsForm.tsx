import { useId, useState } from 'react'
import type { Credentials } from '@shared/ipc'

interface Props {
  /** The service's name, for the labels. */
  name: string
  busy: boolean
  /** What went wrong the last time, shown beside the fields. */
  error?: string
  /** Shown above the fields: what the service requires the app to say, or where the details go. */
  children?: React.ReactNode
  onSubmit: (credentials: Credentials) => void
  onCancel: () => void
}

/**
 * Asks for an account's email and password. The password lives only in this form while it is being typed:
 * it is cleared as soon as it is sent, and is never kept anywhere else in the app.
 */
export function CredentialsForm({ name, busy, error, children, onSubmit, onCancel }: Props): React.JSX.Element {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const ids = { email: useId(), password: useId() }

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    if (!username.trim() || !password) return
    onSubmit({ username, password })
    // Whatever the outcome, the password is no longer needed here; the email stays so a typo is easy to fix.
    setPassword('')
  }

  return (
    <form className="credentials-form" aria-label={`Sign in to ${name}`} onSubmit={submit} onKeyDown={(event) => event.key === 'Escape' && onCancel()}>
      {children}
      <div className="credentials-fields">
        <label htmlFor={ids.email}>
          Email
          <input id={ids.email} type="email" autoComplete="username" autoFocus spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} />
        </label>
        <label htmlFor={ids.password}>
          Password
          <input id={ids.password} type="password" autoComplete="current-password" spellCheck={false} value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
      </div>
      {error && (
        <p className="credentials-error" role="alert">
          {error}
        </p>
      )}
      <div className="credentials-actions">
        <button type="submit" className="chip-action" disabled={busy || !username.trim() || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <button type="button" className="chip-action chip-secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
