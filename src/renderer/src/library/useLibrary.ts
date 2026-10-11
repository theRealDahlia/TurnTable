import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ProviderId, ProviderStatus, Track } from '@shared/types'
import { describeError } from '@shared/errors'

export interface ProviderLibrary {
  status: 'loading' | 'ready' | 'error'
  tracks: Track[]
  error?: string
}

interface State {
  phase: 'listing' | 'ready' | 'error'
  providers: ProviderStatus[]
  libraries: Partial<Record<ProviderId, ProviderLibrary>>
  error?: string
}

type Action =
  | { type: 'listed'; providers: ProviderStatus[] }
  | { type: 'listFailed'; error: string }
  | { type: 'providerStarted'; id: ProviderId }
  | { type: 'pageLoaded'; id: ProviderId; tracks: Track[] }
  | { type: 'providerDone'; id: ProviderId }
  | { type: 'providerFailed'; id: ProviderId; error: string }

const initialState: State = { phase: 'listing', providers: [], libraries: {} }

function reducer(state: State, action: Action): State {
  const update = (id: ProviderId, change: (current: ProviderLibrary) => ProviderLibrary): State => ({
    ...state,
    libraries: { ...state.libraries, [id]: change(state.libraries[id] ?? { status: 'loading', tracks: [] }) }
  })

  switch (action.type) {
    case 'listed':
      return { phase: 'ready', providers: action.providers, libraries: {} }
    case 'listFailed':
      return { ...state, phase: 'error', error: action.error }
    case 'providerStarted':
      return update(action.id, () => ({ status: 'loading', tracks: [] }))
    case 'pageLoaded':
      return update(action.id, (lib) => ({ ...lib, tracks: [...lib.tracks, ...action.tracks] }))
    case 'providerDone':
      return update(action.id, (lib) => ({ ...lib, status: 'ready' }))
    case 'providerFailed':
      return update(action.id, (lib) => ({ ...lib, status: 'error', error: action.error }))
  }
}

export interface Library {
  /** Still asking which services are connected. */
  listing: boolean
  /** Failed to ask which services are connected. */
  error?: string
  providers: ProviderStatus[]
  libraries: Partial<Record<ProviderId, ProviderLibrary>>
  /** Every loaded track from every connected service, in service order. */
  tracks: Track[]
  /** Still checking connections or fetching pages; false once everything has settled. */
  loading: boolean
  /** Starts over: re-checks connections and re-fetches every library. */
  reload(): void
  /** Re-fetches one service, e.g. after an error. */
  retry(id: ProviderId): void
}

/**
 * Loads the saved tracks of every connected service in the background, page by page, so search and
 * sorting cover the whole library. Services load in parallel and fail independently.
 */
export function useLibrary(): Library {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [reloadCount, setReloadCount] = useState(0)
  const runCounter = useRef(0)
  /** The run whose results are still wanted; 0 once unmounted, so a superseded run's results are dropped. */
  const generation = useRef(0)

  const loadProvider = useCallback(async (id: ProviderId, run: number): Promise<void> => {
    dispatch({ type: 'providerStarted', id })
    try {
      let cursor: string | undefined
      do {
        const page = await window.turntable.getSavedTracks(id, cursor)
        if (run !== generation.current) return
        dispatch({ type: 'pageLoaded', id, tracks: page.tracks })
        cursor = page.nextCursor
      } while (cursor)
      dispatch({ type: 'providerDone', id })
    } catch (e) {
      if (run === generation.current) dispatch({ type: 'providerFailed', id, error: describeError(e) })
    }
  }, [])

  useEffect(() => {
    const run = ++runCounter.current
    generation.current = run
    void (async () => {
      try {
        const providers = await window.turntable.listProviders()
        if (run !== generation.current) return
        dispatch({ type: 'listed', providers })
        await Promise.all(providers.filter((p) => p.connected).map((p) => loadProvider(p.id, run)))
      } catch (e) {
        if (run === generation.current) dispatch({ type: 'listFailed', error: describeError(e) })
      }
    })()
    return () => {
      generation.current = 0
    }
  }, [reloadCount, loadProvider])

  const tracks = useMemo(
    () => state.providers.flatMap((provider) => state.libraries[provider.id]?.tracks ?? []),
    [state.providers, state.libraries]
  )

  return {
    listing: state.phase === 'listing',
    error: state.error,
    providers: state.providers,
    libraries: state.libraries,
    tracks,
    loading: state.phase === 'listing' || Object.values(state.libraries).some((lib) => lib.status === 'loading'),
    reload: useCallback(() => setReloadCount((count) => count + 1), []),
    retry: useCallback((id: ProviderId) => void loadProvider(id, generation.current), [loadProvider])
  }
}
