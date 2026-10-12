import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { isPlayable, playbackUrl } from '@shared/media'
import type { Track } from '@shared/types'
import { describeError, isAbortError } from '@shared/errors'
import { createDefaultMedia } from './defaultMedia'
import { errorMessageOf, type PlayerMedia } from './media'
import { APP_NAME } from '@shared/app'

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error'

interface State {
  track?: Track
  status: PlayerStatus
  currentTime: number
  duration: number
  volume: number
  error?: string
  hasNext: boolean
  hasPrevious: boolean
  /** Tracks are played in a random order instead of the order they are listed in. */
  shuffle: boolean
}

type Action =
  | { type: 'started'; track: Track; hasNext: boolean; hasPrevious: boolean }
  | { type: 'status'; status: PlayerStatus }
  | { type: 'time'; currentTime: number }
  | { type: 'duration'; duration: number }
  | { type: 'volume'; volume: number }
  | { type: 'failed'; error: string }
  | { type: 'shuffle'; on: boolean; hasNext: boolean; hasPrevious: boolean }

const initialState: State = { status: 'idle', currentTime: 0, duration: 0, volume: 1, hasNext: false, hasPrevious: false, shuffle: false }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'started':
      return { ...state, track: action.track, status: 'loading', currentTime: 0, duration: action.track.durationMs / 1000, error: undefined, hasNext: action.hasNext, hasPrevious: action.hasPrevious }
    case 'status':
      return { ...state, status: action.status, error: action.status === 'error' ? state.error : undefined }
    case 'time':
      return { ...state, currentTime: action.currentTime }
    case 'duration':
      return { ...state, duration: action.duration }
    case 'volume':
      return { ...state, volume: action.volume }
    case 'failed':
      return { ...state, status: 'error', error: action.error }
    case 'shuffle':
      return { ...state, shuffle: action.on, hasNext: action.hasNext, hasPrevious: action.hasPrevious }
  }
}

/** A track further than this into playback restarts on "previous" instead of going back. */
const RESTART_THRESHOLD_S = 3

const MEDIA_ERRORS: Record<number, string> = {
  2: 'The audio could not be loaded.',
  3: 'This file is damaged or could not be decoded.',
  4: 'This audio format is not supported.'
}

export interface Player extends State {
  /** Plays `track`, with `queue` (in order) deciding what "next" and "previous" mean. Only the queue's tracks from the same service as `track` are used. */
  play(track: Track, queue?: Track[]): void
  toggle(): void
  pause(): void
  next(): void
  previous(): void
  seek(seconds: number): void
  setVolume(volume: number): void
  /** Turns shuffle on or off. The track that is playing carries on; the rest of the queue is reordered. */
  setShuffle(on: boolean): void
}

export interface PlayerOptions {
  createAudio?: () => PlayerMedia
  /** Source of randomness in [0, 1) for shuffling; injectable so tests are deterministic. */
  random?: () => number
}

const sameTrack = (a: Track, b: Track): boolean => a.providerId === b.providerId && a.id === b.id

/** While shuffling there is no last song: more passes are added as they are needed. This keeps the history from growing for ever. */
const MAX_ORDER = 2000
const KEPT_ORDER = 1000

/** `tracks` in random order, with `first` (when it is among them) moved to the front, so shuffling never skips the song you are on. */
function shuffled(tracks: Track[], first: Track | undefined, random: () => number): Track[] {
  const rest = tracks.filter((track) => !first || !sameTrack(track, first))
  // Fisher-Yates, so every order is equally likely.
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j]!, rest[i]!]
  }
  return first && tracks.some((track) => sameTrack(track, first)) ? [first, ...rest] : rest
}

/**
 * Plays tracks through one plain <audio> element. There is deliberately no Web Audio graph, EQ or
 * normalization in between, so lossless files reach the output as decoded.
 */
export function usePlayer({ createAudio = createDefaultMedia, random = Math.random }: PlayerOptions = {}): Player {
  const [state, dispatch] = useReducer(reducer, initialState)
  // Only the first factory is used: re-creating the element on a re-render would cut off playback.
  const [audioFactory] = useState(() => createAudio)
  const audioRef = useRef<PlayerMedia | null>(null)
  /** The tracks in the order they will play (shuffled, if shuffle is on) and which of them is current. */
  const queueRef = useRef<{ tracks: Track[]; index: number }>({ tracks: [], index: -1 })
  /** The queue in the order it was listed, to go back to when shuffle is turned off. */
  const listedRef = useRef<Track[]>([])
  const shuffleRef = useRef(false)
  const randomRef = useRef(random)
  /** Identifies the load in progress, so a late failure of a superseded load is ignored. */
  const loadId = useRef(0)

  /** Whether there is a song after position `index`: the next one in the order, or, while shuffling, another pass. */
  const canAdvance = useCallback((index: number): boolean => {
    return index >= 0 && (index < queueRef.current.tracks.length - 1 || (shuffleRef.current && listedRef.current.length > 1))
  }, [])

  const loadIndex = useCallback((index: number) => {
    const audio = audioRef.current
    const track = queueRef.current.tracks[index]
    const url = track && playbackUrl(track)
    if (!audio || !track || !url) return

    queueRef.current.index = index
    const id = ++loadId.current
    dispatch({ type: 'started', track, hasNext: canAdvance(index), hasPrevious: index > 0 })
    audio.src = url
    audio.play().catch((error: unknown) => {
      if (id !== loadId.current || isAbortError(error)) return
      dispatch({ type: 'failed', error: describeError(error) })
    })
  }, [canAdvance])

  /** Moves on to the next song, if there is one. Shuffling never runs out: it starts another pass in a new order. */
  const advance = useCallback((): boolean => {
    const { tracks, index } = queueRef.current
    if (index < tracks.length - 1) {
      loadIndex(index + 1)
      return true
    }
    if (!shuffleRef.current || listedRef.current.length < 2) return false

    const pass = shuffled(listedRef.current, undefined, randomRef.current)
    const current = tracks[index]
    // The same song twice in a row would feel like the shuffle had stalled.
    if (current && pass[0] && sameTrack(pass[0], current)) [pass[0], pass[1]] = [pass[1]!, pass[0]]
    let order = [...tracks, ...pass]
    let at = index
    if (order.length > MAX_ORDER) {
      const drop = order.length - KEPT_ORDER
      order = order.slice(drop)
      at -= drop
    }
    queueRef.current = { tracks: order, index: at }
    loadIndex(at + 1)
    return true
  }, [loadIndex])

  const next = useCallback(() => void advance(), [advance])

  const previous = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    const { index } = queueRef.current
    if (audio.currentTime > RESTART_THRESHOLD_S || index <= 0) {
      audio.currentTime = 0
      dispatch({ type: 'time', currentTime: 0 })
    } else loadIndex(index - 1)
  }, [loadIndex])

  useEffect(() => {
    const audio = audioFactory()
    audioRef.current = audio

    const on = (type: string, listener: (event: Event) => void): void => audio.addEventListener(type, listener)
    on('playing', () => dispatch({ type: 'status', status: 'playing' }))
    on('waiting', () => dispatch({ type: 'status', status: 'loading' }))
    on('pause', () => {
      if (!audio.ended && queueRef.current.index >= 0) dispatch({ type: 'status', status: 'paused' })
    })
    on('timeupdate', () => dispatch({ type: 'time', currentTime: audio.currentTime }))
    on('durationchange', () => {
      if (Number.isFinite(audio.duration)) dispatch({ type: 'duration', duration: audio.duration })
    })
    on('ended', () => {
      if (!advance()) dispatch({ type: 'status', status: 'paused' })
    })
    on('error', (event) => {
      // Sources like Spotify explain their failures themselves; a real <audio> element only has an error code.
      dispatch({ type: 'failed', error: errorMessageOf(event) ?? MEDIA_ERRORS[audio.error?.code ?? 0] ?? 'Playback failed.' })
    })

    return () => {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      audioRef.current = null
    }
  }, [audioFactory, loadIndex, advance])

  const play = useCallback(
    (track: Track, queue: Track[] = [track]) => {
      if (!isPlayable(track)) {
        dispatch({ type: 'failed', error: `${track.title} can't be played in ${APP_NAME} yet.` })
        return
      }
      // A queue never crosses services: Spotify's and SoundCloud's rules don't allow their tracks to be mixed with others'.
      const playable = queue.filter((t) => t.providerId === track.providerId && isPlayable(t))
      const listedIndex = playable.findIndex((t) => sameTrack(t, track))
      const listed = listedIndex >= 0 ? playable : [track]
      listedRef.current = listed
      queueRef.current = shuffleRef.current
        ? { tracks: shuffled(listed, track, randomRef.current), index: 0 }
        : { tracks: listed, index: Math.max(0, listedIndex) }
      loadIndex(queueRef.current.index)
    },
    [loadIndex]
  )

  const setShuffle = useCallback((on: boolean) => {
    shuffleRef.current = on
    const { tracks, index } = queueRef.current
    const current = tracks[index]
    if (current) {
      const listed = listedRef.current
      if (on) queueRef.current = { tracks: shuffled(listed, current, randomRef.current), index: 0 }
      else queueRef.current = { tracks: listed, index: Math.max(0, listed.findIndex((t) => sameTrack(t, current))) }
    }
    const after = queueRef.current
    dispatch({ type: 'shuffle', on, hasNext: canAdvance(after.index), hasPrevious: after.index > 0 })
  }, [canAdvance])

  const pause = useCallback(() => audioRef.current?.pause(), [])

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio || queueRef.current.index < 0) return
    if (audio.paused) {
      audio.play().catch((error: unknown) => {
        if (!isAbortError(error)) dispatch({ type: 'failed', error: describeError(error) })
      })
    } else audio.pause()
  }, [])

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(seconds)) return
    const limit = Number.isFinite(audio.duration) ? audio.duration : Infinity
    audio.currentTime = Math.min(Math.max(0, seconds), limit)
    dispatch({ type: 'time', currentTime: audio.currentTime })
  }, [])

  const setVolume = useCallback((volume: number) => {
    const clamped = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1))
    if (audioRef.current) audioRef.current.volume = clamped
    dispatch({ type: 'volume', volume: clamped })
  }, [])

  return { ...state, play, toggle, pause, next, previous, seek, setVolume, setShuffle }
}
