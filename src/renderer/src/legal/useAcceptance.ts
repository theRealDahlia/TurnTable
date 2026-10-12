import { useCallback, useState } from 'react'
import { LEGAL_VERSION } from '@shared/legal'

export const ACCEPTANCE_KEY = 'muze.accepted-legal-version'

function readAccepted(): boolean {
  try {
    return window.localStorage.getItem(ACCEPTANCE_KEY) === LEGAL_VERSION
  } catch {
    // Storage can be unavailable; then the user is simply asked again next time.
    return false
  }
}

/** Whether the user has agreed to the current version of the agreement and privacy policy, and a way to record that they do. */
export function useAcceptance(): { accepted: boolean; accept: () => void } {
  const [accepted, setAccepted] = useState(readAccepted)

  const accept = useCallback(() => {
    try {
      window.localStorage.setItem(ACCEPTANCE_KEY, LEGAL_VERSION)
    } catch {
      // Not saved, but the user did agree, so carry on for this session.
    }
    setAccepted(true)
  }, [])

  return { accepted, accept }
}
