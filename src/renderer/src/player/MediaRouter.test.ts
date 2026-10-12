import { describe, expect, it, vi } from 'vitest'
import { errorEvent, errorMessageOf, type PlayerMedia } from './media'
import { MediaRouter } from './MediaRouter'

class FakeMedia extends EventTarget implements PlayerMedia {
  src = ''
  currentTime = 0
  volume = 1
  duration = Number.NaN
  paused = true
  ended = false
  error: { code: number } | null = null
  play = vi.fn(async () => void (this.paused = false))
  pause = vi.fn(() => void (this.paused = true))
  removeAttribute = vi.fn(() => void (this.src = ''))
  load = vi.fn()
  emit(type: string): void {
    this.dispatchEvent(new Event(type))
  }
}

const LOCAL_URL = 'turntable-media://audio/' + 'a'.repeat(24)
const SPOTIFY_URI = 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh'

function setup() {
  const local = new FakeMedia()
  const spotify = new FakeMedia()
  const router = new MediaRouter(local, { spotify })
  const heard: string[] = []
  for (const type of ['playing', 'pause', 'timeupdate', 'durationchange', 'ended', 'waiting']) router.addEventListener(type, () => heard.push(type))
  const errors: (string | undefined)[] = []
  router.addEventListener('error', (event) => errors.push(errorMessageOf(event)))
  return { router, local, spotify, heard, errors }
}

describe('MediaRouter source selection', () => {
  it('uses the local element for local files', () => {
    const { router, local, spotify } = setup()
    router.src = LOCAL_URL
    expect(local.src).toBe(LOCAL_URL)
    expect(spotify.src).toBe('')
    expect(router.src).toBe(LOCAL_URL)
  })

  it('uses Spotify for Spotify URIs', () => {
    const { router, local, spotify } = setup()
    router.src = SPOTIFY_URI
    expect(spotify.src).toBe(SPOTIFY_URI)
    expect(local.src).toBe('')
    expect(router.src).toBe(SPOTIFY_URI)
  })

  it('stops and clears the backend it leaves, in both directions', () => {
    const { router, local, spotify } = setup()
    router.src = LOCAL_URL
    router.src = SPOTIFY_URI
    expect(local.pause).toHaveBeenCalledOnce()
    expect(local.removeAttribute).toHaveBeenCalledWith('src')

    router.src = LOCAL_URL
    expect(spotify.pause).toHaveBeenCalledOnce()
    expect(spotify.removeAttribute).toHaveBeenCalledWith('src')
  })

  it('does not stop anything when staying on the same backend', () => {
    const { router, local } = setup()
    router.src = LOCAL_URL
    router.src = LOCAL_URL.replace('a', 'b')
    expect(local.pause).not.toHaveBeenCalled()
  })
})

describe('MediaRouter delegation', () => {
  it('sends transport and position to the active backend only', async () => {
    const { router, local, spotify } = setup()
    router.src = SPOTIFY_URI

    await router.play()
    router.pause()
    router.currentTime = 42
    router.load()

    expect(spotify.play).toHaveBeenCalledOnce()
    expect(spotify.pause).toHaveBeenCalledOnce()
    expect(spotify.currentTime).toBe(42)
    expect(spotify.load).toHaveBeenCalledOnce()
    expect(local.play).not.toHaveBeenCalled()
    expect(local.currentTime).toBe(0)
  })

  it('reads state from the active backend', () => {
    const { router, local, spotify } = setup()
    local.currentTime = 5
    local.duration = 100
    local.paused = false
    spotify.currentTime = 9
    spotify.duration = 300
    spotify.ended = true
    spotify.error = { code: 4 }

    expect(router).toMatchObject({ currentTime: 5, duration: 100, paused: false, ended: false, error: null })
    router.src = SPOTIFY_URI
    expect(router).toMatchObject({ currentTime: 9, duration: 300, paused: true, ended: true, error: { code: 4 } })
  })

  it('clears the source on both backends', () => {
    const { router, local, spotify } = setup()
    router.removeAttribute('src')
    expect(local.removeAttribute).toHaveBeenCalledWith('src')
    expect(spotify.removeAttribute).toHaveBeenCalledWith('src')
  })
})

describe('MediaRouter volume', () => {
  it('applies the volume to both backends', () => {
    const { router, local, spotify } = setup()
    router.volume = 0.3
    expect(local.volume).toBe(0.3)
    expect(spotify.volume).toBe(0.3)
    expect(router.volume).toBe(0.3)
  })

  it('applies the chosen volume to a backend it switches to', () => {
    const { router, spotify } = setup()
    router.volume = 0.6
    spotify.volume = 1
    router.src = SPOTIFY_URI
    expect(spotify.volume).toBe(0.6)
  })
})

describe('MediaRouter events', () => {
  it('passes on the active backend events', () => {
    const { router, local, heard } = setup()
    router.src = LOCAL_URL
    for (const type of ['playing', 'timeupdate', 'durationchange', 'pause', 'ended']) local.emit(type)
    expect(heard).toEqual(['playing', 'timeupdate', 'durationchange', 'pause', 'ended'])
  })

  it('silences the backend that is not in use', () => {
    const { router, local, spotify, heard } = setup()
    router.src = SPOTIFY_URI
    local.emit('playing')
    local.emit('timeupdate')
    spotify.emit('playing')
    expect(heard).toEqual(['playing'])
  })

  it('does not report the shutdown of the backend it just left', () => {
    const { router, local, heard } = setup()
    router.src = LOCAL_URL
    local.pause.mockImplementation(() => {
      local.emit('pause')
      return undefined
    })
    router.src = SPOTIFY_URI
    expect(heard).toEqual([])
  })

  it('keeps the message of custom error events, and passes plain ones on without one', () => {
    const { router, local, spotify, errors } = setup()
    router.src = SPOTIFY_URI
    spotify.dispatchEvent(errorEvent('Spotify Premium is required.'))
    router.src = LOCAL_URL
    local.emit('error')
    expect(errors).toEqual(['Spotify Premium is required.', undefined])
  })

  it('can deliver the same kind of event repeatedly', () => {
    const { local, heard } = setup()
    local.emit('timeupdate')
    local.emit('timeupdate')
    expect(heard).toEqual(['timeupdate', 'timeupdate'])
  })
})

describe('MediaRouter with several streaming services', () => {
  const YOUTUBE_SOURCE = 'youtube:abcdefghijk'

  function setupThree() {
    const local = new FakeMedia()
    const spotify = new FakeMedia()
    const youtube = new FakeMedia()
    const router = new MediaRouter(local, { spotify, youtube })
    const heard: string[] = []
    router.addEventListener('playing', () => heard.push('playing'))
    return { router, local, spotify, youtube, heard }
  }

  it('picks the backend by the source\'s scheme', () => {
    const { router, local, spotify, youtube } = setupThree()
    router.src = YOUTUBE_SOURCE
    expect([youtube.src, spotify.src, local.src]).toEqual([YOUTUBE_SOURCE, '', ''])
    router.src = SPOTIFY_URI
    expect([youtube.src, spotify.src, local.src]).toEqual(['', SPOTIFY_URI, ''])
    router.src = LOCAL_URL
    expect(local.src).toBe(LOCAL_URL)
  })

  it('stops and clears the backend it leaves, and only that one', () => {
    const { router, spotify, youtube } = setupThree()
    router.src = YOUTUBE_SOURCE
    router.src = SPOTIFY_URI
    expect(youtube.pause).toHaveBeenCalledOnce()
    expect(youtube.removeAttribute).toHaveBeenCalledWith('src')
    expect(spotify.pause).not.toHaveBeenCalled()
  })

  it('treats a source with an unknown scheme, or a URL with a scheme of its own, as local', () => {
    const { router, local, youtube } = setupThree()
    router.src = 'deezer:123'
    expect(local.src).toBe('deezer:123')
    router.src = 'youtube://not-a-source'
    expect(youtube.src).toBe('')
    expect(local.src).toBe('youtube://not-a-source')
  })

  it('does not mistake names on the object prototype for a scheme', () => {
    const { router, local } = setupThree()
    router.src = 'constructor:x'
    expect(local.src).toBe('constructor:x')
  })

  it('applies the volume to every backend and only hears the active one', () => {
    const { router, local, spotify, youtube, heard } = setupThree()
    router.volume = 0.4
    expect([local.volume, spotify.volume, youtube.volume]).toEqual([0.4, 0.4, 0.4])
    router.src = YOUTUBE_SOURCE
    spotify.emit('playing')
    local.emit('playing')
    youtube.emit('playing')
    expect(heard).toEqual(['playing'])
  })

  it('clears the source on every backend', () => {
    const { router, local, spotify, youtube } = setupThree()
    router.removeAttribute('src')
    for (const backend of [local, spotify, youtube]) expect(backend.removeAttribute).toHaveBeenCalledWith('src')
  })
})
