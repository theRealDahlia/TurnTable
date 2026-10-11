/**
 * Holds the window's place as the app the system's media keys go to. Music that plays inside someone else's
 * page (YouTube's player is a frame from youtube.com) is controlled by that page, which knows nothing about
 * this app's queue, so the keyboard's skip keys never reach the app. A silent sound playing in the app's own
 * page gives the app its own media session, whose handlers (see `useMediaSession`) do know the queue.
 */
export interface SessionKeeper {
  start(): void
  stop(): void
}

/** Media this short is ignored by the browser's media controls, so the silence is longer than any threshold. */
const SILENCE_SECONDS = 10
const SAMPLE_RATE = 8000

/** A mono, 8-bit WAV file of silence. */
export function silentWav(seconds = SILENCE_SECONDS, sampleRate = SAMPLE_RATE): Uint8Array {
  const samples = Math.round(seconds * sampleRate)
  const bytes = new Uint8Array(44 + samples)
  const view = new DataView(bytes.buffer)
  const text = (offset: number, value: string): void => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true) // size of the format chunk
  view.setUint16(20, 1, true) // plain PCM
  view.setUint16(22, 1, true) // one channel
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate, true) // bytes per second: one byte per sample
  view.setUint16(32, 1, true) // bytes per frame
  view.setUint16(34, 8, true) // bits per sample
  text(36, 'data')
  view.setUint32(40, samples, true)
  // Unsigned 8-bit audio is centred on 128, so that is silence.
  bytes.fill(128, 44)
  return bytes
}

/** The keeper the app uses: a looping, silent <audio> element, made the first time it is needed. */
export function createSilentKeeper(): SessionKeeper {
  let audio: HTMLAudioElement | undefined

  const element = (): HTMLAudioElement | undefined => {
    if (audio) return audio
    // Not every environment can make one (no Audio, no object URLs); the keys then simply work as they did.
    if (typeof Audio === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return undefined
    audio = new Audio(URL.createObjectURL(new Blob([silentWav() as BlobPart], { type: 'audio/wav' })))
    audio.loop = true
    audio.volume = 1
    return audio
  }

  return {
    start() {
      void element()?.play().catch(() => undefined)
    },
    stop() {
      audio?.pause()
    }
  }
}
