# Muze Privacy Policy

> **Draft.** Fill in the three `[bracketed]` items, have someone qualified review it, and re-check it against what the app does each time that changes. It describes the app as built in this repository. Muze is not affiliated with Spotify, YouTube, Google, TIDAL or Qobuz.

**Effective date:** [date you publish it]
**Who we are:** [your name or organization] ("we"), the developer of Muze, a desktop app that lets you browse and play your own music from the services you connect.
**Contact:** [contact email address]

## The short version

- Muze runs on your computer. We run no servers for it, and **we do not receive, collect or store any of your data.**
- Muze talks directly from your computer to the services you connect (Spotify, YouTube, TIDAL, Qobuz), using your own accounts.
- Your sign-in tokens are kept on your computer, encrypted. Everything else from those services is held in memory and gone when you quit.
- There is no advertising, analytics, tracking or crash reporting in Muze. We never sell or share your data, and we never use it to train machine-learning models.
- You can disconnect any service in the app at any time.

## What Muze handles, and why

| What | Where it comes from | Why | Where it lives |
| --- | --- | --- | --- |
| Sign-in tokens (access and refresh tokens) | Spotify, Google (for YouTube) and TIDAL, after you sign in in your browser; Qobuz, after you sign in in Muze | To act for your account without asking you to sign in every time | A file on your computer, encrypted with your operating system's secure storage (on macOS, the Keychain). Never sent anywhere except back to the service that issued it. |
| Your Qobuz email and password | You, in Muze's Qobuz sign-in form | Qobuz has no browser sign-in for apps, so the form is the only way to sign in | Sent once to Qobuz over HTTPS to get a token. **Not stored, logged or shown.** Only the token Qobuz returns is kept. |
| Your saved tracks, likes and search results | The service's own interface, on request | To show your library and your searches, and to save or un-save a song when you ask | In memory only. Not written to disk; gone when you quit, and dropped for a service when you disconnect it. |
| Track details (title, artist, album, artwork, length) | The service | To display tracks and play them | In memory only, as above. |
| Local music folders you choose | You, in a folder picker | To read and play your own music files | The list of folder paths is saved in a file on your computer. Your music files stay where they are. Muze reads their tags and artwork on your computer and sends nothing about them anywhere. |
| A "try again after" time | Spotify, when it limits requests | So Muze does not ask Spotify again until it says to | A small file on your computer. |
| Playback state (what is playing, position, volume) | Muze and the services' players | To run the player bar and media keys | In memory only. |

## What each service receives

Muze asks each service for the minimum permission it needs. What a service does with your data is governed by that service's own policy.

- **Spotify** (permissions: read your library, save and remove songs, stream, start playback on Muze's player, and read your email and account type, which Spotify's player needs to sign in). Playback runs in Spotify's own player inside Muze, which Spotify's code controls.
  Spotify Privacy Policy: https://www.spotify.com/legal/privacy-policy/
- **YouTube** (permission: `youtube.force-ssl`, to read your liked videos, search, and like or un-like videos at your request). Videos play in YouTube's own embedded player, shown in Muze's sidebar. YouTube may set cookies and collect data when its player is used. Muze does not play videos YouTube marks as made for kids, because YouTube's rules require tracking to be off for those and Muze cannot switch it off in YouTube's player.
  By using Muze's YouTube features you also agree to the [YouTube Terms of Service](https://www.youtube.com/t/terms) and the [Google Privacy Policy](https://policies.google.com/privacy).
- **TIDAL** (permissions: read your saved tracks, save and remove tracks, search the catalog, and play audio). Playback runs in TIDAL's own player inside a hidden Muze window, which receives your TIDAL access token from Muze to play audio; that player is TIDAL's code, and Muze does not control what it sends to TIDAL. Muze does not send TIDAL the play reports that TIDAL's own apps send.
  TIDAL's terms: https://tidal.com/terms
- **Qobuz** (your account, via the sign-in form: your favorites, search and the streaming address of tracks you play).
  Qobuz's terms and privacy information: https://www.qobuz.com
- **Local files** involve no service.

The players of Spotify, TIDAL and YouTube run inside Muze's window and are not controlled by us. They may store cookies or cache files in Muze's data folder on your computer.

## Google API Services

**Muze uses YouTube API Services.** Muze's use and transfer to any other app of information received from Google APIs will adhere to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Muze uses Google user data only to show your liked videos and search results, and to like or un-like a video when you ask. It is not transferred to anyone, used for advertising, or read by people.

## Who we share data with

Nobody. We do not have your data to share. Muze sends your requests directly to the services you connected, and nothing else leaves your computer.

## How long data is kept, and how to delete it

- **Disconnect** a service on the Connections page. Muze deletes that service's tokens from your computer at once and removes its tracks and search results from the app. For Google (YouTube) it also asks Google to revoke Muze's access. Muze does not ask Spotify, TIDAL or Qobuz to revoke its access when you disconnect (Spotify's Web API has no such request, and Muze does not send one to TIDAL or Qobuz), so also remove Muze at https://www.spotify.com/account/apps/ (Spotify), look for a way to remove Muze in your TIDAL account settings, or change your Qobuz password, if you want its access ended on their side too.
- **Google data and permissions:** you can also review and remove Muze's access to your Google account at https://myaccount.google.com/permissions. Anything we hold for your Google account is deleted within 7 days of your request, and because Muze stores nothing off your computer, disconnecting deletes it immediately.
- **Everything else** held in memory disappears when you quit Muze. Anything still showing from a service (such as the track in the player bar) disappears at that point at the latest.
- **Remove all local data:** quit Muze and delete its data folder (on macOS, `~/Library/Application Support/turntable` today; if the app is renamed when packaged, the new name replaces `turntable`). That removes tokens, folder paths, the rate-limit time and any cookies or cache the services' players stored.

## Security

Tokens are encrypted with your operating system's secure storage. Muze talks to services over HTTPS. Passwords and tokens are never written to logs or put in web addresses. No system is perfectly secure, and anyone who can use your computer logged in as you could use Muze as you.

## Children

Muze is not directed at children and we do not knowingly collect information from them.

## Your rights

Because we hold no personal data about you, there is nothing for us to access, correct or erase. Depending on where you live, you may have rights over the data the services themselves hold. Use each service's own privacy settings or contact them.

## Changes

If this policy changes we will update the date above, and in the app's repository the change history shows what changed.

## Contact

Questions about this policy: [contact email address]
