import { startYouTubePage, type CommandHandler, type YtNamespace } from './page'
import type { YouTubePlayerEvent } from '@shared/youtubePlayer'

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void
    YT?: YtNamespace
  }
}

// The app's window may be a file:// page, whose origin can't be named as a target, so events go to
// whoever embeds this page. Only the app's frame is listened to, and nothing sent here is sensitive.
const post = (event: YouTubePlayerEvent): void => window.parent.postMessage(event, '*')

let handle: CommandHandler | undefined
window.addEventListener('message', (event) => {
  if (event.source === window.parent) handle?.(event.data)
})

// YouTube's script calls this once it has loaded, so it must exist before the script is added.
window.onYouTubeIframeAPIReady = () => {
  if (window.YT) handle = startYouTubePage(window.YT, { element: 'player', origin: window.location.origin, post })
}

const script = document.createElement('script')
script.src = 'https://www.youtube.com/iframe_api'
script.onerror = () => post({ type: 'load-failed' })
document.head.append(script)
