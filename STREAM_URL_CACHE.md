# Stream URL Caching

## Problem

The Flutter app uses `youtube_explode_dart` to resolve YouTube audio stream URLs directly. This causes:

- **Rate limiting** — YouTube blocks IPs that make too many requests
- **Slow load times** — each URL fetch takes 2–8 seconds
- **Failures** — some videos return errors or timeout

## Solution

The Flutter app resolves the stream URL (client-side works fine) and pushes it to the server for caching. The server stores it on the song document and returns it in song responses. Other sessions or devices get the cached URL instantly without hitting YouTube.

## Flow

```
1. App resolves stream URL via youtube_explode_dart
2. App calls POST /songs/:id/stream-url with { streamUrl, expiresAt }
3. Server saves streamUrl + streamUrlExpiresAt to songs/{id} in Firestore
4. GET /songs and GET /songs/:id return streamUrl + streamUrlExpiresAt if not expired
5. App uses cached URL directly — no YouTube call needed
6. When URL expires, app resolves a fresh one and pushes it again
```

## API

### Save stream URL
```
POST /songs/:id/stream-url
Content-Type: application/json

{
  "streamUrl": "https://rr2---sn-xxx.googlevideo.com/videoplayback?...",
  "expiresAt": "2026-04-28T04:00:00.000Z"
}
```

### Song response (includes stream URL when valid)
```json
{
  "id": "abc123",
  "title": "Tití Me Preguntó",
  "youtubeId": "fX8DqAt5QVE",
  "streamUrl": "https://rr2---sn-xxx.googlevideo.com/videoplayback?...",
  "streamUrlExpiresAt": "2026-04-28T04:00:00.000Z"
}
```

`streamUrl` and `streamUrlExpiresAt` are `null` when no URL has been cached or the cached URL has expired.

## Notes

- YouTube stream URLs contain `expire=<unix_timestamp>` — use that value as `expiresAt`
- TTL is typically ~6 hours
- The server invalidates the in-memory cache for the song when a new stream URL is saved
