# Stream URL Caching

## Problem

The Flutter app uses `youtube_explode_dart` to resolve YouTube audio stream URLs directly. This causes:

- **Rate limiting** — YouTube blocks IPs that make too many requests
- **Slow load times** — each URL fetch takes 2–8 seconds
- **Failures** — some videos return errors or timeout

## Solution

The Flutter app resolves the stream URL (client-side works fine) and pushes it to the server for caching. The server stores it and returns it in all song/mix responses. Other sessions or devices get the cached URL instantly without hitting YouTube.

## Flow

### Songs
```
1. App receives a song from any endpoint (search, trending, list, detail)
2. If streamUrl is null or streamUrlExpiresAt is in the past → resolve via youtube_explode_dart
3. App calls POST /songs/:id/stream-url with { streamUrl, expiresAt }
4. Server saves streamUrl + streamUrlExpiresAt to songs/{id} in Firestore
5. All song endpoints return streamUrl + streamUrlExpiresAt when valid
6. When URL expires, app resolves a fresh one and pushes it again
```

### Mixes
```
1. App receives a mix from search/trending results
2. If streamUrl is null or expired → resolve via youtube_explode_dart using mix.youtubeId
3. App calls POST /songs/mixes/:youtubeId/stream-url with { streamUrl, expiresAt }
4. Server saves to mixes/{youtubeId} in Firestore
5. Search/trending results include streamUrl + streamUrlExpiresAt for mixes when valid
```

## API

### Save song stream URL
```
POST /songs/:id/stream-url
Content-Type: application/json

{
  "streamUrl": "https://rr2---sn-xxx.googlevideo.com/videoplayback?...",
  "expiresAt": "2026-04-28T04:00:00.000Z"
}
```

### Save mix stream URL
```
POST /songs/mixes/:youtubeId/stream-url
Content-Type: application/json

{
  "streamUrl": "https://rr2---sn-xxx.googlevideo.com/videoplayback?...",
  "expiresAt": "2026-04-28T04:00:00.000Z"
}
```

## Song/Mix Response Shape

All endpoints return the same `SearchSongDto` shape for songs:

```json
{
  "id": "firestore-song-id",
  "title": "Tití Me Preguntó",
  "artistName": "Bad Bunny",
  "artistId": "artist-id",
  "albumId": "album-id",
  "album": "Un Verano Sin Ti",
  "youtubeId": "fX8DqAt5QVE",
  "thumbnailUrl": "https://...",
  "duration": 245,
  "rank": 1,
  "genres": ["reggaeton", "latin"],
  "tags": ["urban", "2024"],
  "listeners": 5000000,
  "streamUrl": "https://rr2---sn-xxx.googlevideo.com/videoplayback?...",
  "streamUrlExpiresAt": "2026-04-28T04:00:00.000Z"
}
```

Mixes (`SearchMixDto`):

```json
{
  "title": "Bad Bunny Mix",
  "youtubeId": "xyz123",
  "thumbnailUrl": "https://...",
  "rank": 1,
  "genres": ["reggaeton"],
  "streamUrl": "https://rr2---sn-xxx.googlevideo.com/videoplayback?...",
  "streamUrlExpiresAt": "2026-04-28T04:00:00.000Z"
}
```

`streamUrl` and `streamUrlExpiresAt` are `null` when no URL has been cached or the cached URL has expired.

## Endpoints that return streamUrl

| Endpoint | Type |
|----------|------|
| `GET /songs` | songs |
| `GET /songs/:id` | song |
| `GET /songs/search-youtube` | songs + mixes |
| `GET /songs/trending` | songs + mixes |
| `GET /songs/:id/generate-playlist` | songs |

## Flutter Implementation

```dart
// After receiving a song from any endpoint:
Future<void> ensureStreamUrl(SearchSongDto song) async {
  if (song.streamUrl != null && song.streamUrlExpiresAt != null) {
    final expires = DateTime.parse(song.streamUrlExpiresAt!);
    if (expires.isAfter(DateTime.now())) return; // still valid
  }

  // Resolve fresh URL
  final video = await yt.videos.streamsClient.getManifest(song.youtubeId);
  final stream = video.audioOnly.withHighestBitrate();
  final expiresAt = _extractExpiry(stream.url.toString());

  // Push to server
  await api.post('/songs/${song.id}/stream-url', body: {
    'streamUrl': stream.url.toString(),
    'expiresAt': expiresAt.toIso8601String(),
  });

  song.streamUrl = stream.url.toString();
  song.streamUrlExpiresAt = expiresAt.toIso8601String();
}

// For mixes (no Firestore id, use youtubeId):
Future<void> ensureMixStreamUrl(SearchMixDto mix) async {
  if (mix.streamUrl != null && mix.streamUrlExpiresAt != null) {
    final expires = DateTime.parse(mix.streamUrlExpiresAt!);
    if (expires.isAfter(DateTime.now())) return;
  }

  final video = await yt.videos.streamsClient.getManifest(mix.youtubeId);
  final stream = video.audioOnly.withHighestBitrate();
  final expiresAt = _extractExpiry(stream.url.toString());

  await api.post('/songs/mixes/${mix.youtubeId}/stream-url', body: {
    'streamUrl': stream.url.toString(),
    'expiresAt': expiresAt.toIso8601String(),
  });

  mix.streamUrl = stream.url.toString();
  mix.streamUrlExpiresAt = expiresAt.toIso8601String();
}

DateTime _extractExpiry(String url) {
  final uri = Uri.parse(url);
  final expire = uri.queryParameters['expire'];
  if (expire != null) {
    return DateTime.fromMillisecondsSinceEpoch(int.parse(expire) * 1000);
  }
  return DateTime.now().add(const Duration(hours: 6));
}
```

## Notes

- YouTube stream URLs contain `expire=<unix_timestamp>` — use that value as `expiresAt`
- TTL is typically ~6 hours
- The server invalidates the in-memory song cache when a new stream URL is saved
- Videos (`SearchVideoDto`) do not have stream URLs — play via YouTube player
