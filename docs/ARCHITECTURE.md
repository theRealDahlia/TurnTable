# Architecture

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Shell | Electron | Chromium's media stack and Widevine DRM support (needed for Spotify's Web Playback SDK) are not available in Tauri's system webviews. |
| Language | TypeScript (strict) | One language and shared types across main, preload, and renderer. |
| UI | React + Vite via `electron-vite` | Fast dev loop, one config for all three bundles. |
| Tests | Vitest | Main-process logic is plain Node, so it is tested without launching Electron. |

## Process layout

- `src/main`: owns everything sensitive. OAuth flows, token storage, provider API calls, and IPC handlers live here.
- `src/preload`: a thin `contextBridge` that exposes `window.turntable` (typed by `src/shared/ipc.ts`). Built as CommonJS because sandboxed preloads cannot be ES modules.
- `src/renderer`: UI and audio playback. It never sees tokens; it asks the main process for data.
- `src/shared`: types and the IPC contract used by all three.

The window runs with `contextIsolation`, `sandbox`, and no Node integration, and a strict CSP. Widen the CSP only as each playback SDK requires.

## Auth

- `auth/oauth.ts`: authorization-code flow with PKCE using a system-browser loopback redirect (RFC 8252), plus refresh. Every streaming service signs in this way; local files need no sign-in.
- `auth/tokenStore.ts`: tokens are encrypted with the OS keychain via Electron `safeStorage`. It refuses to write when encryption is unavailable. At startup it deletes the tokens of services the app no longer has.

## Providers

Every service implements `MusicProvider` (`connect`, `disconnect`, `getSavedTracks`, and optionally search, saving and albums). Spotify, YouTube, TIDAL and local files are real integrations; a service without one would be a placeholder that throws `NotImplementedError`.

## Audio fidelity

- Local files and lossless streams should play through a plain `<audio>` element or a decoded buffer with no resampling, EQ, or normalization in the path by default, so what is sent to the device is what was decoded.
- Quality is capped by the service, not by Muze. `maxQuality` on each provider records the ceiling.
- Spotify (SDK playback needs Widevine, so the stock Electron binary must be swapped for the castLabs Widevine build) and YouTube (embed only, no public API) are lossy.

## Open questions

- Which services we can legally and technically support: each has its own terms on third-party playback.
- Widevine: switching to the castLabs Electron build, and signing/VMP requirements for distribution.
