import { exposeAppApi } from './app'
import { exposePlayerPageBridge } from './player-page'
import { roleForPath } from './role'
import { exposeTidalPageBridge } from './tidal-page'

// A sandboxed preload cannot load a second file, so one preload serves every window and exposes only
// what the window it landed in needs. A player page never sees the app's API, nor the other player's, and vice versa.
const role = roleForPath(location.pathname)
if (role === 'spotify-player') exposePlayerPageBridge()
else if (role === 'tidal-player') exposeTidalPageBridge()
else exposeAppApi()
