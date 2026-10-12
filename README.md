# Muze

The repository and folder are still named TurnTable.

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
2. Add this redirect URI exactly: `http://127.0.0.1:43821/callback`. Spotify's dashboard rejects a loopback URI without a port as insecure, so Muze always uses port 43821 for Spotify sign-in (`SPOTIFY_REDIRECT_PORT` in `src/main/providers/spotify/config.ts`). If that port is busy on your machine, change the constant and the registered URI together.
3. Copy `.env.example` to `.env` and paste the app's client ID into `MAIN_VITE_SPOTIFY_CLIENT_ID`. No client secret is needed.
4. Restart `npm run dev`, then click Connect on the Spotify chip.

Spotify apps in development mode only work for accounts you add under User Management in the dashboard.

## YouTube Music setup

YouTube Music has no API of its own, so Muze uses the official YouTube Data API with your Google account and reads the videos you have liked (your YouTube Music thumbs-ups are the same likes). Use **Refresh** on the Library page after liking a song to pull it in: its menu has Refresh all, plus one choice per connected service. Only videos in YouTube's Music category are shown, in the order YouTube returns them (most recently liked first). YouTube does not report when a video was liked, so these tracks have no save date.

1. In the [Google Cloud console](https://console.cloud.google.com/) create a project and enable **YouTube Data API v3**.
2. Under APIs & Services, configure the OAuth consent screen (External), add the scope `https://www.googleapis.com/auth/youtube.force-ssl` (it covers reading your likes and liking or un-liking a song; the read-only scope can't change likes), and add your own Google account as a **test user**. While the app is in *Testing*, Google expires its sign-in after 7 days, so you will need to reconnect weekly.
3. Create an OAuth client of type **Desktop app**. Any loopback port is accepted, so no redirect URI needs registering.
4. Put the client ID in `.env` as `MAIN_VITE_YOUTUBE_CLIENT_ID`. Google also issues a client secret for Desktop clients and its token endpoint may require it; if sign-in fails with "client_secret is missing", set `MAIN_VITE_YOUTUBE_CLIENT_SECRET` too. For installed apps it is not confidential.
5. Restart `npm run dev`, then click Connect on the YouTube Music chip.

The default quota is 10,000 units a day and each page of 50 likes costs 1.

**Playback.** YouTube only allows its videos to play in its own embedded player, and the video has to stay visible, so YouTube Music tracks play in a square video window at the bottom of the sidebar (with a link back to YouTube Music). The sidebar is about 208 pixels wide, which clears YouTube's 200-pixel minimum. The player bar's play, pause, seek and volume controls drive it. Audio quality is whatever YouTube streams. Some videos' owners turn off embedding; those tracks show a disabled play button with an explanation. In a packaged build the player page is served from a loopback server on `127.0.0.1` (YouTube needs a real web origin), which serves only that page and its scripts.

## SoundCloud setup

SoundCloud's official API signs you in with OAuth 2.1 (Authorization Code with PKCE) and gives your app a client ID and a client secret; SoundCloud treats every app as confidential, so both are needed. The secret stays in the main process and is never sent to a page.

1. Register an app at https://soundcloud.com/you/apps (SoundCloud may need to approve new apps first).
2. Add this redirect URI exactly: `http://127.0.0.1:43823/callback` (`SOUNDCLOUD_REDIRECT_PORT` in `src/main/providers/soundcloud/config.ts`; change both together).
3. Put the client ID and secret in `.env` as `MAIN_VITE_SOUNDCLOUD_CLIENT_ID` and `MAIN_VITE_SOUNDCLOUD_CLIENT_SECRET`.
4. Restart `npm run dev`, then click Connect on the SoundCloud chip.

**What it does.** Your liked tracks (`GET /me/likes/tracks`) fill the Library, and the Search page searches SoundCloud and likes or un-likes tracks. Tracks play in SoundCloud's own player, in the same square at the bottom of the sidebar that YouTube uses: it carries SoundCloud's logo and a "Playing from SoundCloud" credit with a link back to the track, as SoundCloud's attribution rules ask. Only tracks that SoundCloud streams in full are playable; previews and blocked tracks show a disabled play button with the reason. Audio quality is whatever SoundCloud streams (AAC, up to 160 kbps through the API). The player page is served by the same loopback server as YouTube's.

Tokens last about an hour and each refresh token works once, so the app stores the new one each time. Disconnecting revokes the app's access on SoundCloud (`POST /disconnect`) and does not touch your own sign-in to soundcloud.com.

## Search

The **Search** page searches every connected service at once and puts each one's results under its own tab (a chip per service; local files are searched in the library already loaded). Press Enter or Search; results are not fetched as you type, because a YouTube search costs quota. The heart on a result saves it to your library on that service (Spotify: a saved song; YouTube Music: a like) and removes it again; the Library catches up the next time you open it.

- Spotify: saving needs the `user-library-modify` scope, so an older sign-in shows **Reconnect** until you sign in again. Search returns ten results a page.
- YouTube Music: saving needs the `youtube.force-ssl` scope (see above), so reconnect once after updating. YouTube Music has no search API of its own, so Muze searches YouTube for embeddable music and keeps only the songs YouTube Music lists (the audio tracks on each artist's "<Artist> - Topic" channel); fan uploads, live clips and other videos are left out. That means a page can show fewer results than it asked for. Google counts a search as one of 100 searches a day, so plan on that.
- More results load by themselves as you scroll to the end of the list (a *Show more* button appears instead if that stops working, or after two pages in a row with nothing to show, so a rare search can't use up the day's YouTube quota). Each page is another search against that quota.
- SoundCloud: search finds tracks you can stream (`GET /tracks`, `access=playable`) and each result says whether you have liked it; the heart likes or un-likes it (`POST` and `DELETE /likes/tracks/{urn}`). There are no scopes, so nothing needs reconnecting.
- Results live in memory only and are never written to disk.

## Shuffle and media keys

The shuffle button in the player bar plays the current queue in a random order. The song that is playing carries on and the rest is reordered (including songs listed before it). There is no last song: when every song has played, a new pass starts in a fresh order that never begins with the song just played, so skipping never runs out (with a single song there is nothing to skip to). Previous goes back through what was played, across passes, and turning shuffle off returns to the listed order from the song that is playing.

**F7** does what the Previous button does and **F9** what the Next button does, whenever the Muze window is in front (a held key counts once; the key combinations with Cmd, Ctrl, Option or Shift are left alone). On most Mac keyboards those keys carry the skip symbols, and they only reach an app as F7 and F9 when you hold Fn or have turned on *Use F1, F2, etc. keys as standard function keys* in System Settings > Keyboard.

The keyboard's media keys drive the same controls where the system delivers them. They reach the app through the browser's Media Session, through key events when a keyboard delivers them to the window, and, for Spotify (which plays in a hidden window), through the media keys that window receives. YouTube Music plays inside YouTube's own embedded player, a frame from youtube.com that would otherwise keep the keys to itself, so while a YouTube track plays the app also plays a looping silent sound of its own, which gives the app its own media session whose skip keys know the queue. If the keys still don't skip YouTube tracks on your machine, a global shortcut is the fallback, but on macOS it needs the Accessibility permission, so it isn't turned on.

## Open decisions

- First service to integrate (Spotify has the most accessible API)
- Which services allow third-party playback at their top quality (see architecture notes)
