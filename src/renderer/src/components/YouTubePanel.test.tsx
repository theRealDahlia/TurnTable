// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { Track } from '@shared/types'
import { YouTubeBridge } from '../player/YouTubeBridge'
import type { VideoSize } from '../lib/useVideoSize'
import { YouTubePanel } from './YouTubePanel'

const URL_ = 'http://127.0.0.1:50321/youtube-player.html'

const youtubeTrack: Track = {
  id: 'abcdefghijk',
  providerId: 'youtubeMusic',
  title: 'Night Ferry',
  artists: ['Ana Veliz'],
  durationMs: 200_000,
  url: 'https://music.youtube.com/watch?v=abcdefghijk'
}
const localTrack: Track = { id: 'a'.repeat(24), providerId: 'local', title: 'Slow Weather', artists: [], durationMs: 1000 }

let getPlayerUrl: ReturnType<typeof vi.fn>

/** A video size that records what the panel asks for, without any of the hook's limits. */
type FakeSize = Omit<VideoSize, 'set' | 'reset'> & { set: Mock<(width: number) => void>; reset: Mock<() => void> }
const size = (overrides: Partial<Pick<VideoSize, 'width' | 'min' | 'max'>> = {}): FakeSize => ({ width: 400, min: 356, max: 800, set: vi.fn(), reset: vi.fn(), ...overrides })

beforeEach(() => {
  getPlayerUrl = vi.fn().mockResolvedValue(URL_)
  Object.assign(window, { turntableYouTube: { getPlayerUrl } })
})
afterEach(cleanup)

const panel = (): HTMLElement | null => document.querySelector('.youtube-panel')

describe('YouTubePanel', () => {
  it('stays out of the way until a YouTube track has been played', () => {
    render(<YouTubePanel size={size()} track={youtubeTrack} bridge={new YouTubeBridge(new EventTarget())} />)
    expect(panel()).toBeNull()
    expect(getPlayerUrl).not.toHaveBeenCalled()
  })

  it('loads the player page into a restricted frame once it is asked for', async () => {
    const bridge = new YouTubeBridge(new EventTarget())
    render(<YouTubePanel size={size()} track={youtubeTrack} bridge={bridge} />)

    await act(async () => bridge.request())

    const frame = (await screen.findByTitle('YouTube player')) as HTMLIFrameElement
    expect(frame.getAttribute('src')).toBe(URL_)
    expect(frame.getAttribute('allow')).toBe('autoplay; encrypted-media')
    const sandbox = frame.getAttribute('sandbox') ?? ''
    expect(sandbox.split(' ')).toEqual(expect.arrayContaining(['allow-scripts', 'allow-same-origin']))
    expect(sandbox).not.toContain('allow-top-navigation')
    expect(sandbox).not.toContain('allow-forms')
  })

  it('connects the bridge to the frame, at the origin of the page it loaded', async () => {
    const bridge = new YouTubeBridge(new EventTarget())
    const attach = vi.spyOn(bridge, 'attach')
    render(<YouTubePanel size={size()} track={youtubeTrack} bridge={bridge} />)

    await act(async () => bridge.request())
    const frame = (await screen.findByTitle('YouTube player')) as HTMLIFrameElement

    expect(attach).toHaveBeenCalledOnce()
    expect(attach.mock.calls[0]?.[0]).toBe(frame.contentWindow)
    expect(attach.mock.calls[0]?.[1]).toBe('http://127.0.0.1:50321')
  })

  it('disconnects the bridge when it goes away', async () => {
    const bridge = new YouTubeBridge(new EventTarget())
    const detach = vi.fn()
    vi.spyOn(bridge, 'attach').mockReturnValue(detach)
    const { unmount } = render(<YouTubePanel size={size()} track={youtubeTrack} bridge={bridge} />)
    await act(async () => bridge.request())
    await screen.findByTitle('YouTube player')

    unmount()

    expect(detach).toHaveBeenCalledOnce()
  })

  it('shows while a YouTube track is current, with credit and a link back to it', async () => {
    const bridge = new YouTubeBridge(new EventTarget())
    render(<YouTubePanel size={size()} track={youtubeTrack} bridge={bridge} />)
    await act(async () => bridge.request())
    await screen.findByTitle('YouTube player')

    expect(panel()?.getAttribute('data-showing')).toBe('true')
    expect(screen.getByText('Video from YouTube')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Open on YouTube Music' })
    expect(link.getAttribute('href')).toBe(youtubeTrack.url)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })

  it('hides, but stays mounted, while anything else plays', async () => {
    const bridge = new YouTubeBridge(new EventTarget())
    const { rerender } = render(<YouTubePanel size={size()} track={youtubeTrack} bridge={bridge} />)
    await act(async () => bridge.request())
    const frame = await screen.findByTitle('YouTube player')

    rerender(<YouTubePanel size={size()} track={localTrack} bridge={bridge} />)

    expect(panel()?.getAttribute('data-showing')).toBe('false')
    expect(screen.queryByRole('link', { name: 'Open on YouTube Music' })).toBeNull()
    expect(document.contains(frame)).toBe(true)
    rerender(<YouTubePanel size={size()} bridge={bridge} />)
    expect(panel()?.getAttribute('data-showing')).toBe('false')
  })

  it('says so when the player page cannot be found', async () => {
    getPlayerUrl.mockRejectedValue(new Error("Error invoking remote method 'youtube:player-url': Error: port in use"))
    const bridge = new YouTubeBridge(new EventTarget())
    render(<YouTubePanel size={size()} track={youtubeTrack} bridge={bridge} />)

    await act(async () => bridge.request())

    expect(await screen.findByText(/port in use/)).toBeTruthy()
    expect(screen.queryByTitle('YouTube player')).toBeNull()
  })

  it('shows that it is loading while it waits for the page address', async () => {
    getPlayerUrl.mockReturnValue(new Promise(() => undefined))
    const bridge = new YouTubeBridge(new EventTarget())
    render(<YouTubePanel size={size()} track={youtubeTrack} bridge={bridge} />)
    await act(async () => bridge.request())
    expect(screen.getByText('Loading YouTube…')).toBeTruthy()
  })
})

describe('YouTubePanel resizing', () => {
  async function shown(video: FakeSize, track: Track = youtubeTrack) {
    const bridge = new YouTubeBridge(new EventTarget())
    const view = render(<YouTubePanel size={video} track={track} bridge={bridge} />)
    await act(async () => bridge.request())
    await screen.findByTitle('YouTube player')
    return { ...view, grip: screen.getByRole('slider', { hidden: true }) }
  }

  it('is as wide as the chosen size', async () => {
    await shown(size({ width: 520 }))
    expect(panel()?.style.width).toBe('520px')
  })

  it('describes the size to assistive technology', async () => {
    const { grip } = await shown(size({ width: 480, min: 356, max: 800 }))
    expect(grip.getAttribute('aria-valuemin')).toBe('356')
    expect(grip.getAttribute('aria-valuemax')).toBe('800')
    expect(grip.getAttribute('aria-valuenow')).toBe('480')
    expect(grip.getAttribute('aria-valuetext')).toBe('480 by 270 pixels')
    expect(grip.getAttribute('aria-label')).toMatch(/arrow up or left to enlarge/i)
  })

  it.each([
    ['ArrowUp', {}, 424],
    ['ArrowLeft', {}, 424],
    ['ArrowDown', {}, 376],
    ['ArrowRight', {}, 376],
    ['ArrowUp', { shiftKey: true }, 496],
    ['ArrowDown', { shiftKey: true }, 304],
    ['Home', {}, 356],
    ['End', {}, 800]
  ])('%s %j sets the width to %i', async (key, modifiers, expected) => {
    const video = size()
    const { grip } = await shown(video)
    fireEvent.keyDown(grip, { key, ...modifiers })
    expect(video.set).toHaveBeenCalledExactlyOnceWith(expected)
  })

  it('leaves other keys alone', async () => {
    const video = size()
    const { grip } = await shown(video)
    fireEvent.keyDown(grip, { key: 'a' })
    fireEvent.keyDown(grip, { key: 'Tab' })
    expect(video.set).not.toHaveBeenCalled()
  })

  it('resets on a double-click', async () => {
    const video = size()
    const { grip } = await shown(video)
    fireEvent.doubleClick(grip)
    expect(video.reset).toHaveBeenCalledOnce()
  })

  it('has buttons for smaller and larger, which stop at the limits', async () => {
    const video = size({ width: 500 })
    await shown(video)
    fireEvent.click(screen.getByRole('button', { name: 'Larger video' }))
    fireEvent.click(screen.getByRole('button', { name: 'Smaller video' }))
    expect(video.set.mock.calls).toEqual([[548], [452]])

    cleanup()
    await shown(size({ width: 356 }))
    expect((screen.getByRole('button', { name: 'Smaller video' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Larger video' }) as HTMLButtonElement).disabled).toBe(false)

    cleanup()
    await shown(size({ width: 800 }))
    expect((screen.getByRole('button', { name: 'Larger video' }) as HTMLButtonElement).disabled).toBe(true)
  })

  describe('dragging the corner', () => {
    beforeEach(() => {
      Element.prototype.setPointerCapture = vi.fn()
    })
    const pointer = (type: string, x: number, y: number) => ({ type, clientX: x, clientY: y, pointerId: 1 })

    it('grows when pulled up or left, and shrinks when pushed down or right', async () => {
      const video = size({ width: 400 })
      const { grip } = await shown(video)

      fireEvent.pointerDown(grip, pointer('pointerdown', 500, 300))
      fireEvent.pointerMove(grip, pointer('pointermove', 440, 300)) // 60 px left
      expect(video.set).toHaveBeenLastCalledWith(460)
      fireEvent.pointerMove(grip, pointer('pointermove', 500, 240)) // 60 px up = 60 * 16/9 wider
      expect(video.set).toHaveBeenLastCalledWith(400 + 60 * (16 / 9))
      fireEvent.pointerMove(grip, pointer('pointermove', 540, 300)) // 40 px right
      expect(video.set).toHaveBeenLastCalledWith(360)
      fireEvent.pointerMove(grip, pointer('pointermove', 500, 330)) // 30 px down
      expect(video.set).toHaveBeenLastCalledWith(400 - 30 * (16 / 9))
    })

    it('follows whichever direction the pointer is pulled further in on a diagonal', async () => {
      const video = size({ width: 400 })
      const { grip } = await shown(video)
      fireEvent.pointerDown(grip, pointer('pointerdown', 500, 300))
      fireEvent.pointerMove(grip, pointer('pointermove', 490, 290)) // 10 left and 10 up: up is worth more
      expect(video.set).toHaveBeenLastCalledWith(400 + 10 * (16 / 9))
      fireEvent.pointerMove(grip, pointer('pointermove', 470, 295)) // 30 left, 5 up
      expect(video.set).toHaveBeenLastCalledWith(430)
    })

    it('measures from where the drag started, so repeated moves do not pile up', async () => {
      const video = size({ width: 400 })
      const { grip } = await shown(video)
      fireEvent.pointerDown(grip, pointer('pointerdown', 500, 300))
      fireEvent.pointerMove(grip, pointer('pointermove', 450, 300))
      fireEvent.pointerMove(grip, pointer('pointermove', 450, 300))
      expect(video.set.mock.calls).toEqual([[450], [450]])
    })

    it('ignores movement when nothing is being dragged, and after the drag ends', async () => {
      const video = size()
      const { grip } = await shown(video)
      fireEvent.pointerMove(grip, pointer('pointermove', 100, 100))
      fireEvent.pointerDown(grip, pointer('pointerdown', 500, 300))
      fireEvent.pointerUp(grip, pointer('pointerup', 500, 300))
      fireEvent.pointerMove(grip, pointer('pointermove', 100, 100))
      expect(video.set).not.toHaveBeenCalled()
    })

    it('keeps the video from swallowing the pointer only while dragging', async () => {
      const { grip } = await shown(size())
      expect(panel()?.getAttribute('data-resizing')).toBe('false')
      fireEvent.pointerDown(grip, pointer('pointerdown', 500, 300))
      expect(panel()?.getAttribute('data-resizing')).toBe('true')
      expect(Element.prototype.setPointerCapture).toHaveBeenCalledWith(1)
      fireEvent.pointerCancel(grip, pointer('pointercancel', 500, 300))
      expect(panel()?.getAttribute('data-resizing')).toBe('false')
    })

    it('ends the drag if the pointer is taken away', async () => {
      const { grip } = await shown(size())
      fireEvent.pointerDown(grip, pointer('pointerdown', 500, 300))
      fireEvent.lostPointerCapture(grip, pointer('lostpointercapture', 0, 0))
      expect(panel()?.getAttribute('data-resizing')).toBe('false')
    })
  })

  it('cannot be reached with the keyboard while it is hidden', async () => {
    await shown(size(), localTrack)
    expect(screen.getByRole('slider', { hidden: true }).getAttribute('tabindex')).toBe('-1')
  })
})
