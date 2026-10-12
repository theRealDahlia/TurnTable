import type { Track } from '@shared/types'
import { soundcloudBridge, type SoundCloudBridge } from '../player/SoundCloudBridge'
import { EmbedPanel } from './EmbedPanel'

interface Props {
  /** What is playing; the panel shows while it is a SoundCloud track. */
  track?: Track
  bridge?: SoundCloudBridge
}

const getPlayerUrl = (): Promise<string> => window.turntableSoundCloud.getPlayerUrl()

/** SoundCloud's player, in the sidebar: it carries SoundCloud's own credit and link, as its terms ask. */
export function SoundCloudPanel({ track, bridge = soundcloudBridge }: Props): React.JSX.Element | null {
  return (
    <EmbedPanel
      provider="soundcloud"
      track={track}
      bridge={bridge}
      getPlayerUrl={getPlayerUrl}
      label="SoundCloud player"
      frameTitle="SoundCloud player"
      loadingText="Loading SoundCloud…"
      credit="Playing from SoundCloud"
      linkLabel="Open on SoundCloud"
    />
  )
}
