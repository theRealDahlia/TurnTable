import * as player from '@tidal-music/player'
import type { TidalPageBridge } from '@shared/tidalPlayer'
import { TIDAL_ERRORS } from '@shared/tidalPlayer'
import { startTidalPage, type TidalSdk } from './page'

declare global {
  interface Window {
    turntableTidalPage: TidalPageBridge
  }
}

const bridge = window.turntableTidalPage

try {
  startTidalPage(bridge, player as unknown as TidalSdk)
} catch {
  bridge.emit({ type: 'error', kind: 'initialization', message: TIDAL_ERRORS.initialization })
}
