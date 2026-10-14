# Muze (repo: TurnTable) — development rules

## Test and fix after every change

After implementing a feature or editing code, test it for bugs, errors, and code smell, and fix everything found before moving on to the next task.

## Work through lists one item at a time

When given a list of features or tasks:

1. Implement the items individually, in order.
2. Test the current item for bugs, errors, and code smell, and fix any issues.
3. Start the next item only once the current item's tests pass.

Example: given 2 features and 1 task, build feature 1, test and fix it until it passes, then feature 2, then the task. Never batch items or skip ahead on a failing test.

## Commit and push each finished feature

After each feature is added and its tests pass, commit it and push it to the GitHub repo TurnTable.

## Spotify Web API rules

Apply these to all Spotify code.

- **Spec:** use the OpenAPI schema at https://developer.spotify.com/reference/web-api/open-api-schema.yaml for every endpoint path, parameter, and response field. Never guess endpoints or field names.
- **Authorization:** Authorization Code with PKCE for user data (https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow). Client Credentials only for public, non-user data. Never the Implicit Grant flow.
- **Redirect URIs:** HTTPS, except `http://127.0.0.1` for local development. Never `http://localhost` or wildcards (https://developer.spotify.com/documentation/web-api/concepts/redirect_uri).
- **Scopes:** request only the minimum for the features being built, never preemptively (https://developer.spotify.com/documentation/web-api/concepts/scopes).
- **Tokens:** store securely, never ship a client secret in client-side code, refresh tokens (https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens), and send the user through authorization again when the refresh token stops working.
- **Rate limits:** on HTTP 429, respect `Retry-After` and use exponential backoff. Never retry immediately or in a tight loop.
- **Deprecated endpoints:** do not use them. Prefer `/playlists/{id}/items` over `/playlists/{id}/tracks`, and `/me/library` over the type-specific library endpoints where `/me/library` offers the operation (it has no read/list operation, so `GET /me/tracks` is still correct for listing saved tracks).
- **Errors:** handle every status code the schema documents for the endpoint, and surface Spotify's returned error message to the user.
- **Developer Terms** (https://developer.spotify.com/terms): do not cache Spotify content beyond what immediate use needs (keep it in memory, never write it to disk), always attribute content to Spotify (logo plus a link back), and never use Spotify data to train machine-learning models.

## Spotify Developer Policy and design rules

These add to the Spotify Web API rules above (https://developer.spotify.com/policy, https://developer.spotify.com/documentation/design).

- **Never mix services:** no Spotify content integrated with, listed beside, or queued with another service's (Policy III.5; design guidelines). Each service has its own library, list and play queue; next, previous and shuffle never cross services.
- **Attribution:** wherever Spotify content or playback appears, show the Spotify logo and a link back ("Open Spotify" style). Use the full logo (icon alone only where space is too tight) from the official pack, unmodified: the green one only on pure black or white, the monochrome one otherwise, at least 70px wide, with clear space equal to half the icon's height.
- **Artwork:** only Spotify's own artwork, in its original form. Never crop, blur, tint, put text, icons or controls over it, or put our logo on it. Round its corners (4px on small screens, 8px on large).
- **Metadata:** show titles exactly as Spotify gives them. They may be shortened to fit, but the full text must be reachable.
- **Playback:** only for Premium accounts. Always show the cover art and metadata of what plays. Never download, rip or record, and never synthesize play counts or follows.
- **Data:** keep Spotify content in memory only; on disconnect delete the tokens and everything from Spotify on screen, and give the user an easy way to disconnect. Don't analyze Spotify content or use it for machine learning. Request only the data and scopes the feature needs.
- **Naming:** the app's name must not start with "Spot" or be confusingly like Spotify; don't use Spotify marks in our name or imply endorsement.
- **Distribution:** development-mode apps work only for allowlisted users. More users needs Spotify's approval. Before release the end-user agreement must contain the V.11 minimum terms, and the privacy policy must be shown before sign-up.

## YouTube API rules

Apply these to all YouTube code (https://developers.google.com/youtube/terms/developer-policies, https://developers.google.com/youtube/terms/api-services-terms-of-service).

- **Official ways only:** the YouTube Data API for data and the YouTube IFrame player for playback. No scraping, no undocumented APIs, no other way to get at audio or video (III.E.6, III.D.7, III.I.14).
- **Player:** never hide, obscure, resize below 200 by 200, modify or block it, and never play from a player that isn't on screen. Don't separate audio from video, and don't download, cache or play offline (III.F, III.I.6, III.I.7, III.I.9, III.E.1).
- **Made for kids:** look up `status.madeForKids` for each video and never embed ones marked as such, since tracking must be off for them and the embedded player has no setting for it (III.E.4.j).
- **Branding and naming:** call it "YouTube", not "YouTube Music" (the API has no YouTube Music access), and show YouTube's own logo and attribution wherever its content appears. Don't suggest endorsement (III.F.2, Terms 10, 13).
- **Actions:** like or un-like a video only when the user clicks, never automatically (III.E.3.d, III.I.2).
- **Data:** keep API data in memory only (it may not be kept beyond 30 days, and nothing is stored). Request only the scope in use. When the user disconnects, revoke the Google token at once and delete their data within 7 days (III.D.2.3, III.E.4).
- **Users:** show a link to the YouTube Terms of Service and say that using the app means agreeing to them. The privacy policy must say the app uses YouTube API Services, link the Google Privacy Policy, and say how to revoke access at https://myaccount.google.com/permissions (III.A).
- **Never mix:** don't merge non-YouTube results into YouTube results, and don't make other sources look like YouTube (III.C.5, III.F.2.b).
- **Quota:** stay within quota. Use more only after YouTube's compliance audit, and only for the approved use.

## TIDAL API rules

Apply these to all TIDAL code. They come from the TIDAL Developer Terms of Service, version 3.0 as of May 6, 2024 (a copy was pasted in by the developer, since the portal can't be read by the tools used here); the Developer Guidelines and Design Guidelines they refer to (https://developer.tidal.com/documentation/guidelines/) have NOT been read. Re-check against the current terms before any release.

- **Non-commercial only:** the Developer Tools are for "non-commercial applications" (I.1). Never charge for Muze or add ads. Distribution beyond the developer needs TIDAL's "Production Mode" approval, which includes a review of the source code and the specific use case (IV), and later material changes must be submitted first.
- **Playback is the open question:** the terms say full-length "Playbacks" are available "solely with respect to TIDAL Embeds" and only to subscribers, and that Playbacks come only through "an official, unmodified version of the TIDAL Player module" (I.3, I.4). Muze plays full tracks through the Player SDK in an app, which those words may not cover. Do not release until TIDAL confirms, or move playback to the TIDAL Embeds player.
- **Don't block TIDAL's usage monitoring:** TIDAL may collect usage data and the developer agrees "not to block or interfere with such efforts" (IV). Muze's discard-everything event sender may do exactly that. Do not ship it; resolve it with TIDAL first.
- **Don't compete:** no product that "functions substantially the same as, or competes with" a TIDAL product (II.1.2). Keep the TIDAL view limited to what a connection needs. Artist pages and album browsing (an artist's albums, an album's tracks) move Muze closer to a TIDAL player; raise them with TIDAL as part of the Production Mode review before release.
- **Content:** keep TIDAL content in memory only, never as a stored database; temporary caching is allowed for metadata and cover art only; show current data (II.1.5, II.1.6). Never alter content, facilitate stream-ripping or downloads, or use it with AI (II.1.8, II.1.19, II.1.20, I.3).
- **Marks:** use TIDAL logos only as the Design Guidelines say (III). The icon from `simple-icons` has not been checked against them.
- **Personal data (Annex 1):** a privacy notice that is public, linked, and shown before sign-up (3.3); only the permissions in use (3.4); an easy way to disconnect, with deletion of that user's data when they do (3.5); never sell or share personal data (3.7); keep it secure in transit and at rest (3.9); tell TIDAL of a breach within 24 hours (3.11).
- **Identity:** never imply Muze is a TIDAL product or endorsed by TIDAL (II.1.9).

- **Official API only:** use the public API at `https://openapi.tidal.com/v2` described by https://tidal-music.github.io/tidal-api-reference/tidal-api-oas.json. Never use the private endpoints that unofficial libraries call, which TIDAL's terms may forbid and which can be switched off.
- **Sign-in:** Authorization Code with PKCE (`login.tidal.com/authorize`, `auth.tidal.com/v1/oauth2/token`) only. No client secret in the app. Loopback redirect only on the registered port.
- **Scopes:** only third-party-tier scopes the feature needs. Never `r_usr` or `w_usr` (internal tier) or ones not yet used. Today: `collection.read`, `collection.write`, `search.read`, `playback`.
- **Ids are opaque:** never build, parse or infer anything from a TIDAL id. They are only checked to be plain (letters, digits, `-`, `_`) before going into a URL or body.
- **Responses are untrusted:** read JSON:API documents defensively (`src/main/providers/tidal/jsonapi.ts`), only keep https artwork and `https://tidal.com/` links, and show TIDAL's own error text, cleaned and cut short.
- **Playback:** TIDAL's audio is played only through its official player SDK (`@tidal-music/player`), never by fetching manifests and decoding them in our own code, and never downloaded, recorded or saved. A TIDAL subscription is needed to play.
- **Play reports:** the player SDK will not play without an event sender. Muze's is a stand-in that discards the reports (`startTidalPage`), so TIDAL gets none, which conflicts with the usage-monitoring term above. It is acceptable only for the developer's own testing.
- **Never mix:** the same one-service-at-a-time rule as the others, until TIDAL's terms say otherwise.
- **Rate limits:** stop at the first 429 until Retry-After has passed, with no retry in between, and keep requests spaced out.
- **Data:** keep TIDAL data in memory only, and delete the token on disconnect.

## Legal documents and user agreement

- The documents in `docs/PRIVACY.md` and `docs/EULA.md` are drafts and mock-ups, not reviewed legal documents. The README says so, and it must keep saying so until a lawyer has reviewed them.
- The app asks users to agree to them before anything runs (`LEGAL_VERSION` in `src/shared/legal.ts`). Change that version whenever either document changes in a way users must agree to again.
- Keep the privacy policy accurate: change it in the same commit as any change to what the app stores, sends or asks for.
- Re-read each service's current terms before adding a feature that touches it, and record anything new in this file.
