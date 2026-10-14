# Muze

The repository and folder are still named TurnTable.

One app to view and play the saved tracks from all of your music streaming services.

## Goal

Connect several streaming accounts (Spotify, Apple Music, YouTube, Tidal, Deezer, …), pull each one's saved/liked tracks, and show each service's library on its own (they are never mixed in one list or one queue, which Spotify's rules require). Playback uses each service's official player or embed.

## Planned features

- Connect/disconnect accounts per service (OAuth)
- Unified library view: search, sort, filter by service
- De-duplication of the same track saved on multiple services
- Play a track through its source service's player
- Periodic sync of saved tracks

## Status

Desktop app (Electron + TypeScript + React) connecting Spotify, YouTube, TIDAL and local music files: each service's saved tracks, search, saving, artist and album pages, and playback through each service's own player. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the setup sections below. Qobuz was supported until it was removed; its stored sign-in, if any, is deleted when the app starts.

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

### Signing Electron so Spotify will play

Spotify's player needs Widevine, and Spotify's licence server refuses the development certificate the castLabs Electron build ships with (every licence request answers HTTP 500 and the player says "Playback error"). castLabs signs the build for free through its EVS service:

1. `python3 -m pip install --upgrade castlabs-evs`, then `python3 -m castlabs_evs.account signup`, and confirm the emailed code with `python3 -m castlabs_evs.account confirm-signup` (`resend` sends the code again). Then `python3 -m castlabs_evs.account refresh` signs you in on this computer.
2. `npm run verify:electron` says what the build has now. "Certificate is valid for development only" means it needs signing.
3. `npm run sign:electron` uploads the Electron app (about 190 MB) to castLabs, which sends back a signature. Run it again after every `npm install` that replaces Electron, because that undoes it.

macOS may report the app's own code signature as inconsistent afterwards (`codesign --verify`), because iCloud Drive adds attributes to folders on the Desktop. Electron still starts and the EVS signature is still valid. A packaged release must be signed with EVS first and then code-signed and notarized by Apple, in that order.

## YouTube setup

Muze is not affiliated with YouTube or YouTube Music. YouTube Music has no API of its own, so Muze uses the official YouTube Data API with your Google account and reads the videos you have liked (your YouTube Music thumbs-ups are the same likes). Use **Refresh** on the Library page after liking a song to pull it in: its menu has Refresh all, plus one choice per connected service. Only videos in YouTube's Music category are shown, in the order YouTube returns them (most recently liked first). YouTube does not report when a video was liked, so these tracks have no save date.

1. In the [Google Cloud console](https://console.cloud.google.com/) create a project and enable **YouTube Data API v3**.
2. Under APIs & Services, configure the OAuth consent screen (External), add the scope `https://www.googleapis.com/auth/youtube.force-ssl` (it covers reading your likes and liking or un-liking a song; the read-only scope can't change likes), and add your own Google account as a **test user**. While the app is in *Testing*, Google expires its sign-in after 7 days, so you will need to reconnect weekly.
3. Create an OAuth client of type **Desktop app**. Any loopback port is accepted, so no redirect URI needs registering.
4. Put the client ID in `.env` as `MAIN_VITE_YOUTUBE_CLIENT_ID`. Google also issues a client secret for Desktop clients and its token endpoint may require it; if sign-in fails with "client_secret is missing", set `MAIN_VITE_YOUTUBE_CLIENT_SECRET` too. For installed apps it is not confidential.
5. Restart `npm run dev`, then click Connect on the YouTube chip.

The default quota is 10,000 units a day and each page of 50 likes costs 1.

**Playback.** YouTube only allows its videos to play in its own embedded player, and the video has to stay visible, so YouTube tracks play in a square video window at the bottom of the sidebar (with a link back to YouTube). The sidebar is about 208 pixels wide, which clears YouTube's 200-pixel minimum. The player bar's play, pause, seek and volume controls drive it. Audio quality is whatever YouTube streams. Some videos' owners turn off embedding; those tracks show a disabled play button with an explanation. In a packaged build the player page is served from a loopback server on `127.0.0.1` (YouTube needs a real web origin), which serves only that page and its scripts.

## TIDAL setup

TIDAL has a public developer platform (https://developer.tidal.com) with a JSON:API web API at `https://openapi.tidal.com/v2`. Apps sign users in with OAuth 2.0 Authorization Code with PKCE at `login.tidal.com`, and ask only for the permissions (scopes) they need. Muze uses `collection.read` and `collection.write` (your saved tracks, and saving or removing one), `search.read` (searching the catalog) and `playback` (playing audio); none of the internal-tier scopes. It needs no client secret.

1. Register an app in the TIDAL developer dashboard (https://developer.tidal.com) and give it those four scopes.
2. Add this redirect URI exactly: `http://127.0.0.1:43824/callback` (`TIDAL_REDIRECT_PORT` in `src/main/providers/tidal/config.ts`; change both together). I don't know whether TIDAL's dashboard accepts a loopback address like this; if it refuses, say so, and the sign-in will need another way to receive the answer.
3. Put the app's client ID in `.env` as `MAIN_VITE_TIDAL_CLIENT_ID`.
4. Restart `npm run dev`, then click Connect on the TIDAL chip.

**What it does.** Your saved tracks (`GET /userCollectionTracks/me/relationships/items`) fill the Library, newest first, with their artists, albums and cover art fetched along with each page. The Search page searches TIDAL (`GET /searchResults`) and saves or removes tracks (`POST` and `DELETE` on the same collection). TIDAL has no way to ask which search results are already saved, so a result's heart starts empty; saving one that is already saved is not an error. Requests are 300 ms apart, and the first "too many requests" answer from TIDAL stops all requests until the time it gave has passed.

**Playback.** TIDAL only lets its own player SDK (`@tidal-music/player`, Apache-2.0) play its audio, so tracks play in a hidden window that runs that SDK, as Spotify's do. It decodes TIDAL's DRM-protected audio with Widevine, so the Electron build must be signed with castLabs EVS (see Spotify setup above). Muze asks for the highest quality (`HI_RES_LOSSLESS`) and TIDAL gives what the account allows; the player bar shows what actually plays. A TIDAL subscription is needed, and TIDAL allows one device to stream at a time, so starting TIDAL elsewhere ends playback here and Muze says so. Sign-in from before playback was added shows **Reconnect**. The SDK refuses to play unless it has an event sender for the play reports TIDAL's own apps produce. TIDAL's real one (`@tidal-music/event-producer`) is marked as for TIDAL's internal use and needs TIDAL's own endpoints, so Muze gives the SDK one that discards the reports, as the SDK's own demo does. **That means TIDAL receives no play reports from Muze, which may matter for how artists are counted and paid, and may conflict with TIDAL's terms for apps; find out before sharing Muze with anyone.**

**Terms.** TIDAL's Developer Terms of Service (version 3.0, May 6, 2024) allow only non-commercial apps, require "Production Mode" approval from TIDAL, including a source-code review, before an app goes beyond the developer's own use, and say full-length playback is available "solely with respect to TIDAL Embeds". Muze plays full tracks through TIDAL's Player SDK in a hidden window, and its stand-in event sender discards the usage reports TIDAL's terms say not to block. Treat Muze's TIDAL connection as for your own testing only until TIDAL says otherwise; see the TIDAL rules in `CLAUDE.md`. TIDAL's Developer Guidelines and Design Guidelines have not been read.

**Not checked.** The requests are written from TIDAL's published API description (https://tidal-music.github.io/tidal-api-reference/), and some details may differ from the live service.

## Search

The **Search** page searches every connected service at once and puts each one's results under its own tab (a chip per service; local files are searched in the library already loaded). Press Enter or Search; results are not fetched as you type, because a YouTube search costs quota. The heart on a result saves it to your library on that service (Spotify: a saved song; YouTube: a like) and removes it again; the Library catches up the next time you open it.

- Spotify: playback needs the `streaming`, `user-read-email` and `user-read-private` scopes (Spotify's player fails with "Invalid token scopes" without all three), and saving needs `user-library-modify`, so an older sign-in shows **Reconnect** until you sign in again. Search returns ten results a page.
- YouTube: saving needs the `youtube.force-ssl` scope (see above), so reconnect once after updating. YouTube Music has no search API of its own, so Muze searches YouTube for embeddable music and keeps only the songs YouTube Music lists (the audio tracks on each artist's "<Artist> - Topic" channel); fan uploads, live clips and other videos are left out. That means a page can show fewer results than it asked for. Google counts a search as one of 100 searches a day, so plan on that.
- More results load by themselves as you scroll to the end of the list (a *Show more* button appears instead if that stops working, or after two pages in a row with nothing to show, so a rare search can't use up the day's YouTube quota). Each page is another search against that quota.
- Results live in memory only and are never written to disk.

The **Sort by** menu beside the tabs orders the results of the tab that is showing: *Best match* (each service's own order), title, artist, album, or length. Playing a result queues the list in the order shown.

## Artist pages

Click an artist's name on a song (in the Library, in Search, on an artist or album page, or in the player bar) to open their page. An artist page belongs to one service, the one the song came from, since services are never mixed. It lists your saved songs by them on that service, then more of their songs that the service's search finds (only songs credited to that exact name are kept). *Find more* looks further; nothing is fetched further on its own, because on YouTube every artist page and every *Find more* is one of the day's 100 searches. Local files have no search, so their artist pages show your files only. Back returns to the page you came from, as you left it; the sidebar leaves artist pages altogether. Like search results, nothing on an artist page is saved to disk.

### Albums

On Spotify and TIDAL an artist page also has a row of the artist's albums, EPs and singles, newest first, that scrolls sideways (with a trackpad, or the arrow buttons). More albums load as the end of the row comes into view: Spotify sends ten at a time, so a long discography costs a request per ten, and only if you scroll that far. Click an album to open its page: its cover, year and length, and every track in album order. **Play** plays the album from the start in order (and turns shuffle off); **Shuffle** plays it shuffled; any track plays with the album as the queue. Back returns to the artist as you left them, row position included, without fetching anything again.

- Spotify: `GET /artists/{id}/albums` (the artist's own albums, singles and compilations, not records they only appear on) and `GET /albums/{id}/tracks`, both current in Spotify's OpenAPI schema and neither needing a new permission.
- TIDAL: `GET /artists/{id}/relationships/albums` and `GET /albums/{id}/relationships/items` from the public API, with no extra permission. Videos on an album are left out.
- Local files: albums are made from your files' own tags (album title, disc and track number), with the first embedded cover found. Files without an album tag aren't on any album.
- YouTube has no albums in its API, so YouTube artist pages have no album row.

## Shuffle and media keys

The queue is always one service's list: next, previous and shuffle never move to another service, and playback stops at the end of the list. The shuffle button in the player bar plays the current queue in a random order. The song that is playing carries on and the rest is reordered (including songs listed before it). There is no last song: when every song has played, a new pass starts in a fresh order that never begins with the song just played, so skipping never runs out (with a single song there is nothing to skip to). Previous goes back through what was played, across passes, and turning shuffle off returns to the listed order from the song that is playing.

**F7** does what the Previous button does and **F9** what the Next button does, whenever the Muze window is in front (a held key counts once; the key combinations with Cmd, Ctrl, Option or Shift are left alone). On most Mac keyboards those keys carry the skip symbols, and they only reach an app as F7 and F9 when you hold Fn or have turned on *Use F1, F2, etc. keys as standard function keys* in System Settings > Keyboard.

The keyboard's media keys drive the same controls where the system delivers them. While TIDAL or Spotify is playing, the system sends the keys to that service's hidden player window, which passes them on to the app. They reach the app through the browser's Media Session, through key events when a keyboard delivers them to the window, and, for Spotify (which plays in a hidden window), through the media keys that window receives. YouTube plays inside YouTube's own embedded player, a frame from youtube.com that would otherwise keep the keys to itself, so while a YouTube track plays the app also plays a looping silent sound of its own, which gives the app its own media session whose skip keys know the queue. If the keys still don't skip YouTube tracks on your machine, a global shortcut is the fallback, but on macOS it needs the Accessibility permission, so it isn't turned on.

## Spotify's request limits

Spotify limits how fast an app may call it, and a development-mode app has a stricter allowance. Muze keeps its requests low:

- A service's library is fetched only when you first open its tab (Local files load at once, since they cost no requests), not when the app starts.
- Spotify requests are sent at least half a second apart, so a long library arrives at a steady pace instead of in a burst.
- A song saved or removed in Search changes the library already loaded by that one song; nothing is fetched again. The Library is fetched again only when you press Refresh.
- The first time Spotify says "too many requests", Muze stops sending anything to Spotify until the time Spotify gave has passed (and for longer if it refuses again straight after). It does not retry in between, and the stop survives restarts. The Library says when to try again.
- Spotify's servers sometimes answer a request with a passing error (502 "An unexpected error occurred", or 500, 503, 504), which in a long library can land on any one of a hundred pages. Muze asks for that page again after 2 seconds and, if need be, after another 5, and only then shows the error. It does this only for reads, never for saving or removing a song, and never for "too many requests". If the Library still stops part-way, **Retry** carries on from the page that failed, keeping the pages already loaded. TIDAL is handled the same way.

## Look and feel

The theme, "Afterglow", follows the system's light or dark setting. It lives in [`src/renderer/src/styles.css`](src/renderer/src/styles.css), and its colours, glow and gradient are tokens at the top of that file. The glow and grain are page backgrounds, painted behind everything, and the bars that the track list scrolls under are opaque, because Spotify forbids putting anything over its artwork or blurring it.

Page titles use [Bricolage Grotesque](https://github.com/ateliertriay/bricolage), bundled through `@fontsource-variable/bricolage-grotesque` so nothing is fetched at runtime. It is licensed under the SIL Open Font License 1.1, which requires the font's copyright notice and licence to go with every copy, so a packaged release must include `node_modules/@fontsource-variable/bricolage-grotesque/LICENSE`.

## Privacy policy

[`docs/PRIVACY.md`](docs/PRIVACY.md) is only a draft of a privacy policy. It describes what the app does today, but it has blanks that still need filling in, it has not been reviewed by a lawyer, and the app does not show it. It is not a real, enforceable legal document. Do not rely on it, and do not release Muze to other people without a proper privacy policy written or reviewed by a lawyer and kept in step with what the app does.

## User agreement

[`docs/EULA.md`](docs/EULA.md) is only a mock-up of an end-user agreement. It is not a real, reviewed or enforceable legal document, it has blanks that still need filling in, and the app does not show it or ask anyone to accept it. Do not rely on it, and do not release Muze to other people without a proper agreement written or reviewed by a lawyer.

## Open decisions

- First service to integrate (Spotify has the most accessible API)
- Which services allow third-party playback at their top quality (see architecture notes)
