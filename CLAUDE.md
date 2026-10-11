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
