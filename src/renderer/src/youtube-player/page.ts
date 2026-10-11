import { isYouTubePlayerCommand, type YouTubePlayerEvent, type YouTubePlayerState } from '@shared/youtubePlayer'

/** The slice of YouTube's IFrame Player API this page uses. */
export interface YtPlayer {
  loadVideoById(videoId: string): void
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  setVolume(volume: number): void
  getCurrentTime(): number
  getDuration(): number
  getPlayerState(): number
  getVideoData(): { video_id?: string }
}

export interface YtNamespace {
  Player: new (
    element: string | HTMLElement,
    options: {
      width: string
      height: string
      playerVars: Record<string, string | number>
      events: { onReady: () => void; onStateChange: (event: { data: number }) => void; onError: (event: { data: number }) => void }
    }
  ) => YtPlayer
}

export interface PageOptions {
  /** Where the player is drawn. */
  element: string | HTMLElement
  /** This page's own origin, which YouTube requires the player to be told about. */
  origin: string
  /** Sends an event to the app that is showing this page. */
  post: (event: YouTubePlayerEvent) => void
  pollMs?: number
  setInterval?: (callback: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
}

const STATES: Record<number, YouTubePlayerState> = { [-1]: 'unstarted', 0: 'ended', 1: 'playing', 2: 'paused', 3: 'buffering', 5: 'cued' }

/** What a command from the app does to the player; returns false for anything malformed, which is ignored. */
export type CommandHandler = (command: unknown) => boolean

/** Creates the YouTube player, reports what it does, and returns the handler for the app's commands. */
export function startYouTubePage(yt: YtNamespace, options: PageOptions): CommandHandler {
  const { post, pollMs = 500, setInterval: startTimer = (cb, ms) => window.setInterval(cb, ms), clearInterval: stopTimer = (h) => window.clearInterval(h as number) } = options

  let timer: unknown

  const report = (): void => {
    const state = STATES[player.getPlayerState()]
    if (!state) return
    const videoId = player.getVideoData().video_id
    const position = player.getCurrentTime()
    const duration = player.getDuration()
    post({
      type: 'state',
      videoId: videoId && videoId.length === 11 ? videoId : null,
      state,
      positionSeconds: Number.isFinite(position) && position > 0 ? position : 0,
      durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : 0
    })
    // Position only moves while playing, so only poll then.
    const moving = state === 'playing' || state === 'buffering'
    if (moving && timer === undefined) timer = startTimer(report, pollMs)
    if (!moving && timer !== undefined) {
      stopTimer(timer)
      timer = undefined
    }
  }

  const player: YtPlayer = new yt.Player(options.element, {
    width: '100%',
    height: '100%',
    // The app draws its own keyboard shortcuts and never needs fullscreen; `origin` is required for the JS API.
    playerVars: { playsinline: 1, enablejsapi: 1, origin: options.origin, rel: 0, disablekb: 1, fs: 0 },
    events: {
      onReady: () => post({ type: 'ready' }),
      onStateChange: () => report(),
      onError: (event) => post({ type: 'error', code: event.data })
    }
  })

  return (command) => {
    if (!isYouTubePlayerCommand(command)) return false
    switch (command.type) {
      case 'load':
        player.loadVideoById(command.videoId)
        break
      case 'play':
        player.playVideo()
        break
      case 'pause':
        player.pauseVideo()
        break
      case 'seek':
        player.seekTo(command.seconds, true)
        report()
        break
      case 'setVolume':
        player.setVolume(Math.round(command.volume * 100))
        break
    }
    return true
  }
}
