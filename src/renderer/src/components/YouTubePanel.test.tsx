// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@shared/types'
import { YouTubeBridge } from '../player/YouTubeBridge'
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

beforeEach(() => {
  getPlayerUrl = vi.fn().mockResolvedValue(URL_)
  Object.assign(window, { turntableYouTube: { getPlayerUrl } })
})
afterEach(cleanup)

const panel = (): HTMLElement | null => document.querySelector('.youtube-panel')

describe('YouTubePanel', () => {
  it('stays out of the way until a YouTube track has been played', () => {
    render(<YouTubePanel track={youtubeTrack} bridge={new YouTubeBridge(new EventTarget())} />)
    expect(panel()).toBeNull()
    expect(getPlayerUrl).not.toHaveBeenCalled()
  })

  it('loads the player page into a restricted frame once it is asked for', async () => {
    const bridge = new YouTubeBridge(new EventTarget())
    render(<YouTubePanel track={youtubeTrack} bridge={bridge} />)

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
    render(<YouTubePanel track={youtubeTrack} bridge={bridge} />)

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
    const { unmount } = render(<YouTubePanel track={youtubeTrack} bridge={bridge} />)
    await act(async () => bridge.request())
    await screen.findByTitle('YouTube player')

    unmount()

    expect(detach).toHaveBeenCalledOnce()
  })

  it('shows while a YouTube track is current, with credit and a link back to it', async () => {
    const bridge = new YouTubeBridge(new EventTarget())
    render(<YouTubePanel track={youtubeTrack} bridge={bridge} />)
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
    const { rerender } = render(<YouTubePanel track={youtubeTrack} bridge={bridge} />)
    await act(async () => bridge.request())
    const frame = await screen.findByTitle('YouTube player')

    rerender(<YouTubePanel track={localTrack} bridge={bridge} />)

    expect(panel()?.getAttribute('data-showing')).toBe('false')
    expect(screen.queryByRole('link', { name: 'Open on YouTube Music' })).toBeNull()
    expect(document.contains(frame)).toBe(true)
    rerender(<YouTubePanel bridge={bridge} />)
    expect(panel()?.getAttribute('data-showing')).toBe('false')
  })

  it('says so when the player page cannot be found', async () => {
    getPlayerUrl.mockRejectedValue(new Error("Error invoking remote method 'youtube:player-url': Error: port in use"))
    const bridge = new YouTubeBridge(new EventTarget())
    render(<YouTubePanel track={youtubeTrack} bridge={bridge} />)

    await act(async () => bridge.request())

    expect(await screen.findByText(/port in use/)).toBeTruthy()
    expect(screen.queryByTitle('YouTube player')).toBeNull()
  })

  it('shows that it is loading while it waits for the page address', async () => {
    getPlayerUrl.mockReturnValue(new Promise(() => undefined))
    const bridge = new YouTubeBridge(new EventTarget())
    render(<YouTubePanel track={youtubeTrack} bridge={bridge} />)
    await act(async () => bridge.request())
    expect(screen.getByText('Loading YouTube…')).toBeTruthy()
  })
})
