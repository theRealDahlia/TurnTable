import { isSoundCloudPlayerCommand, soundcloudWidgetUrl, type SoundCloudPlayerEvent, type SoundCloudPlayerState } from '@shared/soundcloudPlayer'

/** What the widget tells its listeners about the track it is playing. */
export interface WidgetEventData {
  soundId?: number
  currentPosition?: number
}

/** The slice of SoundCloud's Widget API this page uses. */
export interface WidgetLike {
  bind(event: string, listener: (data?: WidgetEventData) => void): void
  load(url: string, options: Record<string, unknown>): void
  play(): void
  pause(): void
  seekTo(milliseconds: number): void
  setVolume(volume: number): void
  getDuration(callback: (milliseconds: number) => void): void
}

export interface ScNamespace {
  Widget: ((iframe: HTMLIFrameElement) => WidgetLike) & {
    Events: Record<'READY' | 'PLAY' | 'PAUSE' | 'FINISH' | 'PLAY_PROGRESS' | 'SEEK' | 'ERROR', string>
  }
}

export interface PageOptions {
  /** The frame the widget is drawn in. It is given an address when the first track is loaded. */
  frame: HTMLIFrameElement
  /** Sends an event to the app that is showing this page. */
  post: (event: SoundCloudPlayerEvent) => void
}

/** What a command from the app does to the player; returns false for anything malformed, which is ignored. */
export type CommandHandler = (command: unknown) => boolean

const WIDGET_OPTIONS = { auto_play: true, visual: true, show_comments: false, show_teaser: false, hide_related: true, buying: false, sharing: false, download: false, liking: false }

/** Creates the widget on demand, reports what it does, and returns the handler for the app's commands. */
export function startSoundCloudPage(sc: ScNamespace, { frame, post }: PageOptions): CommandHandler {
  const { Events } = sc.Widget
  let widget: WidgetLike | undefined
  let current: string | undefined
  let lastState: SoundCloudPlayerState = 'unstarted'
  let lastPositionMs = 0
  let durationSeconds = 0

  const report = (state: SoundCloudPlayerState, positionMs = lastPositionMs): void => {
    lastState = state
    lastPositionMs = Number.isFinite(positionMs) ? Math.max(0, positionMs) : 0
    post({ type: 'state', trackId: current ?? null, state, positionSeconds: lastPositionMs / 1000, durationSeconds })
  }

  /** Runs `act` for what the widget says about the track we asked for; reports about a track we left are not ours. */
  const forCurrent = (act: (data: WidgetEventData) => void) => (data?: WidgetEventData) => {
    if (current !== undefined && data && String(data.soundId) === current) act(data)
  }

  const learnDuration = (): void => {
    widget?.getDuration((ms) => {
      durationSeconds = Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0
      report(lastState)
    })
  }

  const bindEvents = (target: WidgetLike): void => {
    target.bind(Events.READY, () => learnDuration())
    target.bind(Events.PLAY, forCurrent((data) => report('playing', data.currentPosition)))
    target.bind(Events.PLAY_PROGRESS, forCurrent((data) => report('playing', data.currentPosition)))
    target.bind(
      Events.PAUSE,
      forCurrent((data) => {
        // A track that has finished also pauses, and must stay finished.
        if (lastState !== 'ended') report('paused', data.currentPosition)
      })
    )
    target.bind(Events.FINISH, forCurrent((data) => report('ended', data.currentPosition ?? durationSeconds * 1000)))
    target.bind(Events.SEEK, forCurrent((data) => report(lastState, data.currentPosition ?? lastPositionMs)))
    target.bind(Events.ERROR, () => post({ type: 'error', code: 0 }))
  }

  const load = (trackId: string): void => {
    current = trackId
    lastState = 'unstarted'
    lastPositionMs = 0
    durationSeconds = 0
    if (widget) {
      widget.load(`https://api.soundcloud.com/tracks/${trackId}`, { ...WIDGET_OPTIONS, callback: () => learnDuration() })
      return
    }
    // The widget API attaches to a frame that already shows the widget.
    frame.src = soundcloudWidgetUrl(trackId)
    widget = sc.Widget(frame)
    bindEvents(widget)
  }

  post({ type: 'ready' })

  return (command) => {
    if (!isSoundCloudPlayerCommand(command)) return false
    switch (command.type) {
      case 'load':
        load(command.trackId)
        break
      case 'play':
        widget?.play()
        break
      case 'pause':
        widget?.pause()
        break
      case 'seek':
        widget?.seekTo(Math.round(command.seconds * 1000))
        break
      case 'setVolume':
        widget?.setVolume(Math.round(command.volume * 100))
        break
    }
    return true
  }
}
