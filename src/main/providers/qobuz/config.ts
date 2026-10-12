export const QOBUZ_API = 'https://www.qobuz.com/api.json/0.2'

export interface QobuzApp {
  appId: string
  appSecret: string
}

/**
 * Qobuz's terms forbid using the API without an application ID and secret that Qobuz issued to you, and forbid
 * sharing them, so there is no built-in default: they come from your own `.env`.
 */
export function qobuzApp(appId: string | undefined, appSecret: string | undefined): QobuzApp {
  if (!appId || !appSecret) {
    throw new Error(
      'Qobuz is not set up: add the application ID and secret Qobuz issued to you to .env as MAIN_VITE_QOBUZ_APP_ID and MAIN_VITE_QOBUZ_APP_SECRET (see README).'
    )
  }
  return { appId, appSecret }
}
