import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ProviderId, ProviderStatus, Track } from '@shared/types'
import { describeError } from '@shared/errors'

export interface ProviderLibrary {
  status: 'loading' | 'ready' | 'error'
  tracks: Track[]
  error?: string
}

type Libraries = Partial<Record<ProviderId, ProviderLibrary>>

interface State {
  phase: 'listing' | 'ready' | 'error'
  providers: ProviderStatus[]
  libraries: Libraries
  error?: string
}

type Action =
  | { type: 'listed'; providers: ProviderStatus[] }
  | { type: 'providersUpdated'; providers: ProviderStatus[] }
  | { type: 'listFailed'; error: string }
  | { type: 'providerStarted'; id: ProviderId }
  | { type: 'pageLoaded'; id: ProviderId; tracks: Track[] }
  | { type: 'providerDone'; id: ProviderId }
  | { type: 'providerFailed'; id: ProviderId; error: string }

const initialState: State = { phase: 'listing', providers: [], libraries: {} }

/** Keeps the libraries of services that are still connected, and drops the rest. */
function onlyConnected(libraries: Libraries, providers: ProviderStatus[]): Libraries {
  const kept: Libraries = {}
  for (const { id, connected } of providers) {
    const library = libraries[id]
    if (connected && library) kept[id] = library
  }
  return kept
}

function reducer(state: State, action: Action): State {
  const update = (id: ProviderId, change: (current: ProviderLibrary) => ProviderLibrary): State => ({
    ...state,
    libraries: { ...state.libraries, [id]: change(state.libraries[id] ?? { status: 'loading', tracks: [] }) }
  })

  switch (action.type) {
    case 'listed':
      return { phase: 'ready', providers: action.providers, libraries: {} }
    case 'providersUpdated':
      // A fresh list of what is connected, without throwing away the libraries that are already loaded.
      return { phase: 'ready', providers: action.providers, libraries: onlyConnected(state.libraries, action.providers) }
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
  libraries: Libraries
  /** Every loaded track from every connected service, in service order. */
  tracks: Track[]
  /** Still checking connections or fetching pages; false once everything has settled. */
  loading: boolean
  /** Starts over: re-checks connections and re-fetches every library. */
  reload(): void
  /**
   * After a service was connected, disconnected or reconfigured: re-checks connections and re-fetches only
   * that service's library (or drops it if it is no longer connected). Other libraries are left alone,
   * so changing one service never costs another service's API calls.
   */
  refreshProvider(id: ProviderId): void
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
  const counter = useRef(0)
  /** Identifies the current full run; 0 once unmounted. Anything started under an older one is dropped. */
  const epoch = useRef(0)
  /** For each service, the load whose results are still wanted; a newer load or a disconnect ends the claim. */
  const wanted = useRef(new Map<ProviderId, number>())
  /** Runs connection checks for single services one after another, so answers are applied in the order asked. */
  const refreshQueue = useRef<Promise<void>>(Promise.resolve())

  const loadProvider = useCallback(async (id: ProviderId): Promise<void> => {
    const run = ++counter.current
    wanted.current.set(id, run)
    const superseded = (): boolean => wanted.current.get(id) !== run

    dispatch({ type: 'providerStarted', id })
    try {
      let cursor: string | undefined
      do {
        const page = await window.turntable.getSavedTracks(id, cursor)
        if (superseded()) return
        dispatch({ type: 'pageLoaded', id, tracks: page.tracks })
        cursor = page.nextCursor
      } while (cursor)
      dispatch({ type: 'providerDone', id })
    } catch (e) {
      if (!superseded()) dispatch({ type: 'providerFailed', id, error: describeError(e) })
    }
  }, [])

  useEffect(() => {
    const claims = wanted.current
    const run = ++counter.current
    epoch.current = run
    claims.clear()

    void (async () => {
      try {
        const providers = await window.turntable.listProviders()
        if (run !== epoch.current) return
        dispatch({ type: 'listed', providers })
        await Promise.all(providers.filter((p) => p.connected).map((p) => loadProvider(p.id)))
      } catch (e) {
        if (run === epoch.current) dispatch({ type: 'listFailed', error: describeError(e) })
      }
    })()
    return () => {
      epoch.current = 0
      claims.clear()
    }
  }, [reloadCount, loadProvider])

  const refreshProvider = useCallback(
    (id: ProviderId): void => {
      // Until the first check of connections has finished there is no list to update, so start over.
      if (state.phase !== 'ready') {
        setReloadCount((count) => count + 1)
        return
      }

      const epochAtCall = epoch.current
      refreshQueue.current = refreshQueue.current.then(async () => {
        try {
          const providers = await window.turntable.listProviders()
          // A full reload (or unmount) since this was asked has already redone everything.
          if (epochAtCall !== epoch.current) return
          dispatch({ type: 'providersUpdated', providers })
          if (providers.some((p) => p.id === id && p.connected)) void loadProvider(id)
          else wanted.current.delete(id)
        } catch (e) {
          if (epochAtCall === epoch.current) dispatch({ type: 'listFailed', error: describeError(e) })
        }
      })
    },
    [state.phase, loadProvider]
  )

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
    refreshProvider,
    retry: useCallback((id: ProviderId) => void loadProvider(id), [loadProvider])
  }
}
