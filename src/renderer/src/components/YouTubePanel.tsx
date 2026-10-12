import type { Track } from '@shared/types'
import { youtubeBridge, type YouTubeBridge } from '../player/YouTubeBridge'
import { EmbedPanel } from './EmbedPanel'

interface Props {
  /** What is playing; the panel shows while it is a YouTube Music track. */
  track?: Track
  bridge?: YouTubeBridge
}

const getPlayerUrl = (): Promise<string> => window.turntableYouTube.getPlayerUrl()

/** YouTube's video, in the sidebar: YouTube only lets its videos play in its own embedded player. */
export function YouTubePanel({ track, bridge = youtubeBridge }: Props): React.JSX.Element | null {
  return (
    <EmbedPanel
      provider="youtubeMusic"
      track={track}
      bridge={bridge}
      getPlayerUrl={getPlayerUrl}
      label="YouTube video"
      frameTitle="YouTube player"
      loadingText="Loading YouTube…"
      credit="Video from YouTube"
      linkLabel="Open on YouTube Music"
    />
  )
}
