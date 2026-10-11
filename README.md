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

## YouTube Music setup

YouTube Music has no API of its own, so TurnTable uses the official YouTube Data API with your Google account and reads the videos you have liked (your YouTube Music thumbs-ups are the same likes). Use **Refresh** on the Library page after liking a song to pull it in: its menu has Refresh all, plus one choice per connected service. Only videos in YouTube's Music category are shown, in the order YouTube returns them (most recently liked first). YouTube does not report when a video was liked, so these tracks have no save date.

1. In the [Google Cloud console](https://console.cloud.google.com/) create a project and enable **YouTube Data API v3**.
2. Under APIs & Services, configure the OAuth consent screen (External), add the scope `https://www.googleapis.com/auth/youtube.force-ssl` (it covers reading your likes and liking or un-liking a song; the read-only scope can't change likes), and add your own Google account as a **test user**. While the app is in *Testing*, Google expires its sign-in after 7 days, so you will need to reconnect weekly.
3. Create an OAuth client of type **Desktop app**. Any loopback port is accepted, so no redirect URI needs registering.
4. Put the client ID in `.env` as `MAIN_VITE_YOUTUBE_CLIENT_ID`. Google also issues a client secret for Desktop clients and its token endpoint may require it; if sign-in fails with "client_secret is missing", set `MAIN_VITE_YOUTUBE_CLIENT_SECRET` too. For installed apps it is not confidential.
5. Restart `npm run dev`, then click Connect on the YouTube Music chip.

The default quota is 10,000 units a day and each page of 50 likes costs 1.

**Playback.** YouTube only allows its videos to play in its own embedded player, and the video has to stay visible, so YouTube Music tracks play in a small video window above the player bar (with a link back to YouTube Music). The player bar's play, pause, seek and volume controls drive it. Drag the corner grip at the window's top-left (or use the − and + buttons, or the arrow keys on the grip) to make it smaller or larger; double-click the grip to reset. The size is 356 to 900 pixels wide, as the window allows (YouTube requires at least 200 pixels of height), and is remembered. Audio quality is whatever YouTube streams. Some videos' owners turn off embedding; those tracks show a disabled play button with an explanation. In a packaged build the player page is served from a loopback server on `127.0.0.1` (YouTube needs a real web origin), which serves only that page and its scripts.

## Search

The **Search** page searches every connected service at once and puts each one's results under its own tab (a chip per service; local files are searched in the library already loaded). Press Enter or Search; results are not fetched as you type, because a YouTube search costs quota. The heart on a result saves it to your library on that service (Spotify: a saved song; YouTube Music: a like) and removes it again; the Library catches up the next time you open it.

- Spotify: saving needs the `user-library-modify` scope, so an older sign-in shows **Reconnect** until you sign in again. Search returns ten results a page; use *Show more* for the next ten.
- YouTube Music: saving needs the `youtube.force-ssl` scope (see above), so reconnect once after updating. Google counts a search as one of 100 searches a day, so plan on that.
- Results live in memory only and are never written to disk.

## Open decisions

- First service to integrate (Spotify has the most accessible API)
- Which services allow third-party playback at their top quality (see architecture notes)
