import type { ProviderId } from './types'
import { APP_NAME } from './app'

/**
 * What a service wants the user told when they are asked to link their account: which of their data the app
 * will use, and why. SoundCloud's API terms require this at account linking.
 */
export const LINK_NOTICES: Partial<Record<ProviderId, string>> = {
  soundcloud: `${APP_NAME} will open SoundCloud in your browser so you can sign in. If you agree, ${APP_NAME} can read the tracks you have liked and search SoundCloud for you, to show and play them here. It likes or un-likes a track only when you choose to. Your SoundCloud data stays on this computer, is kept only in memory, and is handled as described in the Privacy Policy.`
}
