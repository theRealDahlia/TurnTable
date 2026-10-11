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

Empty scaffold. Stack and first service integration still to be decided.

## Open decisions

- Platform: web app, desktop (Electron), or mobile
- First service to integrate (Spotify has the most accessible API)
- Where to store tokens and the cached library (local only vs. a backend)
