import { useCallback, useEffect, useReducer, useRef } from 'react'
import { describeError } from '@shared/errors'
import type { ProviderId, Track } from '@shared/types'

export interface ProviderResults {
  status: 'loading' | 'ready' | 'error'
  tracks: Track[]
  error?: string
  /** Pass to `loadMore` for the next page; absent when there are no more. */
  nextCursor?: string
  loadingMore: boolean
}

interface State {
  /** What was searched for last, trimmed. Empty before the first search. */
  query: string
  /** One entry for each service that was searched. */
  results: Partial<Record<ProviderId, ProviderResults>>
  /** The service whose results are showing. */
  tab?: ProviderId
  /** Tracks whose save or removal is still being sent, by key. */
  pending: Record<string, true>
  /** The last save or removal that failed, for the service it concerns. */
  saveError?: { providerId: ProviderId; message: string }
}

type Action =
  | { type: 'started'; query: string; ids: ProviderId[]; tabs: ProviderId[] }
  | { type: 'loaded'; id: ProviderId; tracks: Track[]; nextCursor?: string; append: boolean }
  | { type: 'failed'; id: ProviderId; error: string }
  | { type: 'retrying'; id: ProviderId }
  | { type: 'loadingMore'; id: ProviderId }
  | { type: 'moreFailed'; id: ProviderId; error: string }
  | { type: 'tab'; id: ProviderId }
  | { type: 'saving'; track: Track; saved: boolean }
  | { type: 'saved'; track: Track }
  | { type: 'saveFailed'; track: Track; revertTo: boolean; message: string }

const initialState: State = { query: '', results: {}, pending: {} }

const without = (pending: State['pending'], key: string): State['pending'] => Object.fromEntries(Object.entries(pending).filter(([k]) => k !== key))

export const trackKey = (track: Pick<Track, 'providerId' | 'id'>): string => `${track.providerId}:${track.id}`

/** Sets `saved` on every copy of the track in the results. */
function withSaved(results: State['results'], track: Track, saved: boolean): State['results'] {
  const own = results[track.providerId]
  if (!own) return results
  return { ...results, [track.providerId]: { ...own, tracks: own.tracks.map((t) => (t.id === track.id ? { ...t, saved } : t)) } }
}

function reducer(state: State, action: Action): State {
  const change = (id: ProviderId, update: (current: ProviderResults) => ProviderResults): State => {
    const current = state.results[id]
    return current ? { ...state, results: { ...state.results, [id]: update(current) } } : state
  }

  switch (action.type) {
    case 'started':
      return {
        query: action.query,
        results: Object.fromEntries(action.ids.map((id) => [id, { status: 'loading', tracks: [], loadingMore: false } satisfies ProviderResults])),
        tab: state.tab && action.tabs.includes(state.tab) ? state.tab : action.tabs[0],
        pending: {}
      }
    case 'loaded':
      return change(action.id, (current) => ({
        status: 'ready',
        tracks: action.append ? [...current.tracks, ...action.tracks] : action.tracks,
        nextCursor: action.nextCursor,
        loadingMore: false
      }))
    case 'failed':
      return change(action.id, () => ({ status: 'error', tracks: [], error: action.error, loadingMore: false }))
    case 'retrying':
      return change(action.id, () => ({ status: 'loading', tracks: [], loadingMore: false }))
    case 'loadingMore':
      return change(action.id, (current) => ({ ...current, loadingMore: true }))
    case 'moreFailed':
      // The results already shown stay; only the attempt to get more failed.
      return { ...change(action.id, (current) => ({ ...current, loadingMore: false })), saveError: { providerId: action.id, message: action.error } }
    case 'tab':
      return { ...state, tab: action.id }
    case 'saving':
      return {
        ...state,
        results: withSaved(state.results, action.track, action.saved),
        pending: { ...state.pending, [trackKey(action.track)]: true },
        saveError: undefined
      }
    case 'saved':
      return { ...state, pending: without(state.pending, trackKey(action.track)) }
    case 'saveFailed':
      return {
        ...state,
        results: withSaved(state.results, action.track, action.revertTo),
        pending: without(state.pending, trackKey(action.track)),
        saveError: { providerId: action.track.providerId, message: action.message }
      }
  }
}

export interface SearchState {
  query: string
  results: Partial<Record<ProviderId, ProviderResults>>
  tab?: ProviderId
  pending: Record<string, true>
  saveError?: { providerId: ProviderId; message: string }
  /**
   * Searches each of `ids` for `query`, all at once; each answers (or fails) on its own. `tabs` lists every tab
   * the page will show, including any that are answered without a search, so the chosen tab can be kept.
   */
  search(query: string, ids: ProviderId[], tabs?: ProviderId[]): void
  /** Fetches the next page of one service's results. */
  loadMore(id: ProviderId): void
  /** Searches one service again, e.g. after an error. */
  retry(id: ProviderId): void
  selectTab(id: ProviderId): void
  /** Saves a track that is not saved yet, or removes one that is. Shows the change at once and undoes it if it fails. */
  toggleSave(track: Track): void
}

export interface SearchOptions {
  /** A save or removal went through, so the service's library has changed. */
  onSaved?: (id: ProviderId) => void
}

/**
 * Searches the connected services in parallel and keeps each one's results apart, so they can be shown as
 * tabs. Nothing is saved to disk: results live only as long as the app does.
 */
export function useSearch({ onSaved }: SearchOptions = {}): SearchState {
  const [state, dispatch] = useReducer(reducer, initialState)
  /** Identifies the current search; answers to an older one are dropped. */
  const run = useRef(0)
  // Handlers read the latest state and callback without being rebuilt (and so re-rendering everything) on every change.
  const stateRef = useRef(state)
  const onSavedRef = useRef(onSaved)
  useEffect(() => {
    stateRef.current = state
    onSavedRef.current = onSaved
  })

  const fetchFirst = useCallback(async (id: ProviderId, query: string, mine: number): Promise<void> => {
    try {
      const page = await window.turntable.searchTracks(id, query)
      if (run.current === mine) dispatch({ type: 'loaded', id, tracks: page.tracks, nextCursor: page.nextCursor, append: false })
    } catch (error) {
      if (run.current === mine) dispatch({ type: 'failed', id, error: describeError(error) })
    }
  }, [])

  const search = useCallback(
    (text: string, ids: ProviderId[], tabs: ProviderId[] = ids): void => {
      const query = text.trim()
      if (!query) return
      const mine = ++run.current
      dispatch({ type: 'started', query, ids, tabs })
      for (const id of ids) void fetchFirst(id, query, mine)
    },
    [fetchFirst]
  )

  const retry = useCallback(
    (id: ProviderId): void => {
      const { query, results } = stateRef.current
      if (!query || results[id]?.status !== 'error') return
      dispatch({ type: 'retrying', id })
      void fetchFirst(id, query, run.current)
    },
    [fetchFirst]
  )

  const loadMore = useCallback((id: ProviderId): void => {
    const { query, results } = stateRef.current
    const own = results[id]
    if (!own?.nextCursor || own.loadingMore) return
    const mine = run.current
    dispatch({ type: 'loadingMore', id })
    window.turntable.searchTracks(id, query, own.nextCursor).then(
      (page) => {
        if (run.current === mine) dispatch({ type: 'loaded', id, tracks: page.tracks, nextCursor: page.nextCursor, append: true })
      },
      (error: unknown) => {
        if (run.current === mine) dispatch({ type: 'moreFailed', id, error: describeError(error) })
      }
    )
  }, [])

  const toggleSave = useCallback((track: Track): void => {
    const key = trackKey(track)
    if (stateRef.current.pending[key]) return
    const wasSaved = track.saved === true
    const mine = run.current
    dispatch({ type: 'saving', track, saved: !wasSaved })

    const request = wasSaved ? window.turntable.unsaveTrack(track.providerId, track.id) : window.turntable.saveTrack(track.providerId, track.id)
    request.then(
      () => {
        // The service's library changed whatever the screen is showing now.
        onSavedRef.current?.(track.providerId)
        if (run.current === mine) dispatch({ type: 'saved', track })
      },
      (error: unknown) => {
        if (run.current === mine) dispatch({ type: 'saveFailed', track, revertTo: wasSaved, message: describeError(error) })
      }
    )
  }, [])

  const selectTab = useCallback((id: ProviderId): void => dispatch({ type: 'tab', id }), [])

  return { ...state, search, loadMore, retry, selectTab, toggleSave }
}
