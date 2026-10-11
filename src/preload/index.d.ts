import type { TurnTableApi } from '@shared/ipc'

declare global {
  interface Window {
    turntable: TurnTableApi
  }
}
