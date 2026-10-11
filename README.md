# TurnTable

One app to view and play the saved tracks from all of your music streaming services.

## Goal

Connect several streaming accounts (Spotify, Apple Music, YouTube Music, Tidal, SoundCloud, Deezer, …), pull each one's saved/liked tracks, and show them together in a single library. Playback uses each service's official player or embed.

## Planned features

- Connect/disconnect accounts per service (OAuth)
- Unified library view: search, sort, filter by service
- De-duplication of the same track saved on multiple services
- Play a track through its source service's player
- Periodic sync of saved tracks

## Status

Desktop scaffold (Electron + TypeScript + React). The window opens and lists the five services, and the OAuth/PKCE and encrypted token-storage building blocks are in place and tested. Every service is still a placeholder; none can sign in yet. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Develop

```bash
npm install
npm run dev      # start the app with hot reload
npm run check    # typecheck + lint + tests
npm run build    # production bundles into out/
```

If the app fails to start with "Electron uninstall", run `node node_modules/electron/install.js` to download the Electron binary.

## Spotify setup

1. Create an app at https://developer.spotify.com/dashboard.
2. Add this redirect URI exactly: `http://127.0.0.1:43821/callback`. Spotify's dashboard rejects a loopback URI without a port as insecure, so TurnTable always uses port 43821 for Spotify sign-in (`SPOTIFY_REDIRECT_PORT` in `src/main/providers/spotify/config.ts`). If that port is busy on your machine, change the constant and the registered URI together.
3. Copy `.env.example` to `.env` and paste the app's client ID into `MAIN_VITE_SPOTIFY_CLIENT_ID`. No client secret is needed.
4. Restart `npm run dev`, then click Connect on the Spotify chip.

Spotify apps in development mode only work for accounts you add under User Management in the dashboard.

## Open decisions

- First service to integrate (Spotify has the most accessible API)
- Which services allow third-party playback at their top quality (see architecture notes)
