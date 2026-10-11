import { exposeAppApi } from './app'
import { exposePlayerPageBridge } from './player-page'
import { roleForPath } from './role'

// A sandboxed preload cannot load a second file, so one preload serves both windows and exposes only
// what the window it landed in needs. The Spotify player page never sees the app's API, and vice versa.
if (roleForPath(location.pathname) === 'spotify-player') exposePlayerPageBridge()
else exposeAppApi()
