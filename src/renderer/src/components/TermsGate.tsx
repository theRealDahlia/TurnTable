import { useState } from 'react'
import { APP_NAME } from '@shared/app'
import type { DocumentFile } from '../legal/documents'
import { LegalDialog } from './LegalDialog'
import { BrandMark } from './icons'

interface Props {
  onAccept: () => void
}

/** What the user sees first: nothing connects, signs in or loads until they have agreed to the documents. */
export function TermsGate({ onAccept }: Props): React.JSX.Element {
  const [agreed, setAgreed] = useState(false)
  const [reading, setReading] = useState<DocumentFile>()

  return (
    <main className="terms-gate">
      <section className="terms-card" aria-labelledby="terms-title">
        <BrandMark className="terms-mark" />
        <h1 id="terms-title">Before you start</h1>
        <p>
          {APP_NAME} plays music from services you already use. It keeps your sign-ins on this computer and has no servers of its own. Please read how it works and agree to continue.
        </p>
        <div className="terms-links">
          <button type="button" className="chip-action chip-secondary" onClick={() => setReading('EULA.md')}>
            Read the End-User Agreement
          </button>
          <button type="button" className="chip-action chip-secondary" onClick={() => setReading('PRIVACY.md')}>
            Read the Privacy Policy
          </button>
        </div>
        <label className="terms-agree">
          <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
          <span>I have read and agree to the End-User Agreement and the Privacy Policy.</span>
        </label>
        <button type="button" className="chip-action" disabled={!agreed} onClick={onAccept}>
          Continue
        </button>
        <p className="terms-note">{APP_NAME} is not affiliated with Spotify, YouTube, Google, TIDAL or Qobuz.</p>
      </section>
      {reading && <LegalDialog initial={reading} onClose={() => setReading(undefined)} />}
    </main>
  )
}
