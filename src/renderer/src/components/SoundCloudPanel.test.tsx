// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@shared/types'
import { SoundCloudBridge } from '../player/SoundCloudBridge'
import { SoundCloudPanel } from './SoundCloudPanel'

const URL_ = 'http://127.0.0.1:50321/soundcloud-player.html'

const soundcloudTrack: Track = {
  id: 'soundcloud:tracks:293',
  providerId: 'soundcloud',
  title: 'Flickermood',
  artists: ['Forss'],
  durationMs: 213_890,
  url: 'https://soundcloud.com/forss/flickermood'
}
const youtubeTrack: Track = { id: 'abcdefghijk', providerId: 'youtubeMusic', title: 'Night Ferry', artists: [], durationMs: 1000 }

let getPlayerUrl: ReturnType<typeof vi.fn>

beforeEach(() => {
  getPlayerUrl = vi.fn().mockResolvedValue(URL_)
  Object.assign(window, { turntableSoundCloud: { getPlayerUrl } })
})
afterEach(cleanup)

const panel = (): HTMLElement | null => document.querySelector('.embed-panel')

async function shown(track: Track | undefined = soundcloudTrack) {
  const bridge = new SoundCloudBridge(new EventTarget())
  const view = render(<SoundCloudPanel track={track} bridge={bridge} />)
  await act(async () => bridge.request())
  await screen.findByTitle('SoundCloud player')
  return { bridge, ...view }
}

describe('SoundCloudPanel', () => {
  it('stays out of the way until a SoundCloud track has been played', () => {
    render(<SoundCloudPanel track={soundcloudTrack} bridge={new SoundCloudBridge(new EventTarget())} />)
    expect(panel()).toBeNull()
    expect(getPlayerUrl).not.toHaveBeenCalled()
  })

  it('loads SoundCloud\'s page into a restricted frame once it is asked for', async () => {
    await shown()
    const frame = screen.getByTitle('SoundCloud player') as HTMLIFrameElement
    expect(frame.getAttribute('src')).toBe(URL_)
    expect(frame.getAttribute('allow')).toBe('autoplay; encrypted-media')
    const sandbox = frame.getAttribute('sandbox') ?? ''
    expect(sandbox.split(' ')).toEqual(expect.arrayContaining(['allow-scripts', 'allow-same-origin']))
    expect(sandbox).not.toContain('allow-top-navigation')
  })

  it('connects its own bridge to the frame, at the origin of the page it loaded', async () => {
    const bridge = new SoundCloudBridge(new EventTarget())
    const attach = vi.spyOn(bridge, 'attach')
    render(<SoundCloudPanel track={soundcloudTrack} bridge={bridge} />)
    await act(async () => bridge.request())
    const frame = (await screen.findByTitle('SoundCloud player')) as HTMLIFrameElement
    expect(attach).toHaveBeenCalledOnce()
    expect(attach.mock.calls[0]?.[0]).toBe(frame.contentWindow)
    expect(attach.mock.calls[0]?.[1]).toBe('http://127.0.0.1:50321')
  })

  it('shows while a SoundCloud track is current, crediting SoundCloud and linking back to the track', async () => {
    await shown()
    expect(panel()?.getAttribute('data-showing')).toBe('true')
    expect(panel()?.getAttribute('aria-label')).toBe('SoundCloud player')
    expect(screen.getByText('Playing from SoundCloud')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Open on SoundCloud' })
    expect(link.getAttribute('href')).toBe(soundcloudTrack.url)
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })

  it('hides, but stays mounted, while a track from another service plays', async () => {
    const { bridge, rerender } = await shown()
    const frame = screen.getByTitle('SoundCloud player')
    rerender(<SoundCloudPanel track={youtubeTrack} bridge={bridge} />)
    expect(panel()?.getAttribute('data-showing')).toBe('false')
    expect(screen.queryByRole('link', { name: 'Open on SoundCloud' })).toBeNull()
    expect(document.contains(frame)).toBe(true)
  })

  it('says so when the player page cannot be found, and while it is being found', async () => {
    getPlayerUrl.mockRejectedValue(new Error("Error invoking remote method 'soundcloud:player-url': Error: port in use"))
    const bridge = new SoundCloudBridge(new EventTarget())
    render(<SoundCloudPanel track={soundcloudTrack} bridge={bridge} />)
    await act(async () => bridge.request())
    expect(await screen.findByText(/port in use/)).toBeTruthy()

    cleanup()
    getPlayerUrl.mockReturnValue(new Promise(() => undefined))
    const waiting = new SoundCloudBridge(new EventTarget())
    render(<SoundCloudPanel track={soundcloudTrack} bridge={waiting} />)
    await act(async () => waiting.request())
    expect(screen.getByText('Loading SoundCloud…')).toBeTruthy()
  })
})
