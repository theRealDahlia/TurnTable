import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { ProviderId, ProviderStatus, Track } from '@shared/types'
import { describeError } from '@shared/errors'

export interface ProviderLibrary {
  status: 'loading' | 'ready' | 'error'
  tracks: Track[]
  error?: string
  /** During a refresh: the new list as it arrives, while `tracks` keeps showing the old one until it is complete. */
  incoming?: Track[]
}

type Libraries = Partial<Record<ProviderId, ProviderLibrary>>

interface State {
  phase: 'listing' | 'ready' | 'error'
  providers: ProviderStatus[]
  libraries: Libraries
  error?: string
  /** Goes up each time the whole list of services is read afresh, so callers that wait for it can tell. */
  listings: number
}

type Action =
  | { type: 'listed'; providers: ProviderStatus[] }
  | { type: 'providersUpdated'; providers: ProviderStatus[] }
  | { type: 'listFailed'; error: string }
  /** `keep` shows the current tracks until the new list is complete, instead of emptying the library first. */
  | { type: 'providerStarted'; id: ProviderId; keep?: boolean }
  | { type: 'pageLoaded'; id: ProviderId; tracks: Track[] }
  | { type: 'providerDone'; id: ProviderId }
  | { type: 'providerFailed'; id: ProviderId; error: string }
  /** One track was saved to a service (`saved`) or removed from it, from outside the library. */
  | { type: 'trackSaved'; track: Track; saved: boolean }

const initialState: State = { phase: 'listing', providers: [], libraries: {}, listings: 0 }

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
      return { phase: 'ready', providers: action.providers, libraries: {}, listings: state.listings + 1 }
    case 'providersUpdated':
      // A fresh list of what is connected, without throwing away the libraries that are already loaded.
      return { ...state, phase: 'ready', providers: action.providers, libraries: onlyConnected(state.libraries, action.providers) }
    case 'listFailed':
      return { ...state, phase: 'error', error: action.error }
    case 'providerStarted':
      return update(action.id, (lib) =>
        action.keep && lib.tracks.length > 0 ? { status: 'loading', tracks: lib.tracks, incoming: [] } : { status: 'loading', tracks: [] }
      )
    case 'pageLoaded':
      return update(action.id, (lib) =>
        lib.incoming ? { ...lib, incoming: [...lib.incoming, ...action.tracks] } : { ...lib, tracks: [...lib.tracks, ...action.tracks] }
      )
    case 'providerDone':
      return update(action.id, (lib) => ({ status: 'ready', tracks: lib.incoming ?? lib.tracks }))
    case 'trackSaved': {
      // A library nobody has opened isn't loaded, and loads fresh when it is.
      const own = state.libraries[action.track.providerId]
      if (!own) return state
      const same = (t: Track): boolean => t.id === action.track.id
      const change = (list: Track[]): Track[] =>
        action.saved
          ? list.some(same)
            ? list
            : [{ ...action.track, saved: undefined, savedAt: new Date().toISOString() }, ...list]
          : list.filter((t) => !same(t))
      return update(action.track.providerId, (lib) => ({ ...lib, tracks: change(lib.tracks), ...(lib.incoming ? { incoming: change(lib.incoming) } : {}) }))
    }
    case 'providerFailed':
      // A refresh that fails leaves the list as it was; a first load keeps whatever pages had arrived.
      return update(action.id, (lib) => ({ status: 'error', tracks: lib.tracks, error: action.error }))
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
  /** A refresh is replacing lists that are already on screen. */
  refreshing: boolean
  /** Starts over: re-checks connections and re-fetches every library. */
  reload(): void
  /**
   * Re-checks connections and re-reads every service whose library has been opened (or only `id`'s, even if it
   * has not been opened yet, leaving the others alone). The lists on screen stay as they are until each new one
   * is complete, and stay if it fails.
   */
  refresh(id?: ProviderId): void
  /**
   * Loads a service's library the first time it is needed, i.e. when its tab is shown, and does nothing if it has
   * already been asked for. Nothing is fetched from a service nobody is looking at, so opening the app costs
   * a service no requests at all until its library is opened. Local files are the exception: they cost no requests.
   */
  ensure(id: ProviderId): void
  /**
   * After a service was connected, disconnected or reconfigured: re-checks connections and re-fetches only
   * that service's library (or drops it if it is no longer connected). Other libraries are left alone,
   * so changing one service never costs another service's API calls.
   */
  refreshProvider(id: ProviderId): void
  /**
   * A song was saved to a service or removed from it, e.g. from a search. Changes the list already loaded by
   * that one track, so the library does not have to be fetched again; a service that has not been opened is left to load when it is.
   */
  noteSaved(track: Track, saved: boolean): void
  /** Re-fetches one service, e.g. after an error. */
  retry(id: ProviderId): void
}

/** Reading local files makes no requests to anyone, so they are loaded at once; every other service waits until it is opened. */
const loadsAtOnce = (id: ProviderId): boolean => id === 'local'

/**
 * Loads a service's saved tracks in the background, page by page, once its library is opened, so search and
 * sorting cover the whole of it. Services load independently and fail independently.
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

  const loadProvider = useCallback(async (id: ProviderId, keep = false): Promise<void> => {
    const run = ++counter.current
    wanted.current.set(id, run)
    const superseded = (): boolean => wanted.current.get(id) !== run

    dispatch({ type: 'providerStarted', id, keep })
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
        await Promise.all(providers.filter((p) => p.connected && loadsAtOnce(p.id)).map((p) => loadProvider(p.id)))
      } catch (e) {
        if (run === epoch.current) dispatch({ type: 'listFailed', error: describeError(e) })
      }
    })()
    return () => {
      epoch.current = 0
      claims.clear()
    }
  }, [reloadCount, loadProvider])

  /** Re-checks which services are connected, then lets `load` act on the answer; answers apply in the order asked. */
  const recheck = useCallback(
    (load: (providers: ProviderStatus[]) => void): void => {
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
          load(providers)
        } catch (e) {
          if (epochAtCall === epoch.current) dispatch({ type: 'listFailed', error: describeError(e) })
        }
      })
    },
    [state.phase]
  )

  const refreshProvider = useCallback(
    (id: ProviderId): void =>
      recheck((providers) => {
        if (!providers.some((p) => p.id === id && p.connected)) wanted.current.delete(id)
        // A library nobody has opened is loaded when it is opened, not now.
        else if (wanted.current.has(id) || loadsAtOnce(id)) void loadProvider(id)
      }),
    [recheck, loadProvider]
  )

  const refresh = useCallback(
    (only?: ProviderId): void =>
      recheck((providers) => {
        for (const { id, connected } of providers) {
          if (!connected) wanted.current.delete(id)
          else if (only === id || (only === undefined && (wanted.current.has(id) || loadsAtOnce(id)))) void loadProvider(id, true)
        }
      }),
    [recheck, loadProvider]
  )

  // It changes when the list of services does, so a page that calls it from an effect asks again once the list is known.
  const providers = state.providers
  const { listings } = state
  const ensure = useCallback(
    (id: ProviderId): void => {
      if (wanted.current.has(id) || !providers.some((p) => p.id === id && p.connected)) return
      void loadProvider(id)
    },
    // `listings` makes it change after a full reload even if the new list looks the same as the old one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [providers, listings, loadProvider]
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
    refreshing: Object.values(state.libraries).some((lib) => lib.incoming !== undefined),
    reload: useCallback(() => setReloadCount((count) => count + 1), []),
    refresh,
    ensure,
    refreshProvider,
    noteSaved: useCallback((track: Track, saved: boolean) => dispatch({ type: 'trackSaved', track, saved }), []),
    retry: useCallback((id: ProviderId) => void loadProvider(id), [loadProvider])
  }
}
