import type { SoundCloudPlayerEvent } from '@shared/soundcloudPlayer'
import { startSoundCloudPage, type CommandHandler, type ScNamespace } from './page'

declare global {
  interface Window {
    SC?: ScNamespace
  }
}

// The app's window may be a file:// page, whose origin can't be named as a target, so events go to
// whoever embeds this page. Only the app's frame is listened to, and nothing sent here is sensitive.
const post = (event: SoundCloudPlayerEvent): void => window.parent.postMessage(event, '*')

let handle: CommandHandler | undefined
window.addEventListener('message', (event) => {
  if (event.source === window.parent) handle?.(event.data)
})

const script = document.createElement('script')
script.src = 'https://w.soundcloud.com/player/api.js'
script.onload = () => {
  const frame = document.getElementById('widget')
  if (window.SC && frame instanceof HTMLIFrameElement) handle = startSoundCloudPage(window.SC, { frame, post })
}
script.onerror = () => post({ type: 'load-failed' })
document.head.append(script)
