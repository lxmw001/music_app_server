# YouTube Search with Caching Plan

## Overview
Server-side YouTube search with Gemini AI cleaning and full result caching. Eliminates YouTube API quota usage for repeated searches and provides instant results.

## Endpoint
```
POST /songs/search-youtube
Body: { "query": "bad bunny" }
```

## Response Format
```json
{
  "songs": [
    {
      "id": "firestore-song-id",
      "title": "Tití Me Preguntó",
      "artistName": "Bad Bunny",
      "youtubeId": "abc123",
      "thumbnailUrl": "https://...",
      "durationSeconds": 245,
      "rank": 1,
      "artistId": "artist-doc-id",
      "albumId": "album-doc-id",
      "genre": "Reggaeton",
      "tags": ["latin", "urban"]
    }
  ],
  "mixes": [
    {
      "title": "Bad Bunny Mix 2024",
      "youtubeId": "xyz789",
      "thumbnailUrl": "https://...",
      "rank": 1
    }
  ],
  "videos": [
    {
      "title": "Bad Bunny - Behind the Scenes",
      "youtubeId": "def456",
      "thumbnailUrl": "https://...",
      "rank": 1
    }
  ],
  "artists": [
    {
      "id": "artist-doc-id",
      "name": "Bad Bunny",
      "imageUrl": "https://...",
      "followerCount": 50000000,
      "rank": 1
    }
  ]
}
```

## Firestore Structure
```
youtube_searches/
  {searchQuery}/
    query: "bad bunny"
    songs: [
      {
        youtubeId: "abc123",
        rank: 1,
        title: "Tití Me Preguntó",
        artistName: "Bad Bunny",
        thumbnailUrl: "https://...",
        durationSeconds: 245,
        songId: null  // or "firestore-song-id" if synced to main songs collection
      }
    ]
    mixes: [
      {
        youtubeId: "xyz789",
        rank: 1,
        title: "Bad Bunny Mix 2024",
        thumbnailUrl: "https://..."
      }
    ]
    videos: [
      {
        youtubeId: "def456",
        rank: 1,
        title: "Bad Bunny - Behind the Scenes",
        thumbnailUrl: "https://..."
      }
    ]
    artists: [
      {
        name: "Bad Bunny",
        rank: 1,
        artistId: null,  // or "firestore-artist-id" if synced
        imageUrl: "https://...",
        followerCount: null
      }
    ]
    lastUpdated: timestamp
    createdAt: timestamp
```

## Flow

### 1. Search Request
```typescript
POST /songs/search-youtube
{ "query": "bad bunny" }
```

### 2. Check Cache
- Query Firestore: `youtube_searches/{normalized-query}`
- If exists and fresh (< 7 days old) → enrich and return
- If not exists or stale → proceed to step 3

### 3. YouTube Search
- Call YouTube API with query
- Get raw results (videos, channels)

### 4. Gemini Classification & Cleaning
**Prompt:**
```
Classify these YouTube results into: songs, mixes, videos, artists.

Rules:
- Songs: Single music tracks. Clean title (remove: Official Video, Lyrics, Audio, VEVO, etc). Extract artist name.
- Mixes: Playlists, compilations, DJ sets, "Best of" collections
- Videos: Interviews, behind-the-scenes, documentaries, live performances (not music videos)
- Artists: Artist channels or profiles

Return JSON:
{
  "songs": [{"title":"Clean Song Title","artistName":"Artist Name","videoId":"abc123"}],
  "mixes": [{"title":"Mix Title","videoId":"xyz789"}],
  "videos": [{"title":"Video Title","videoId":"def456"}],
  "artists": [{"name":"Artist Name"}]
}

Input: [YouTube results array]
```

### 5. Save to Firestore
```typescript
await firestore.doc(`youtube_searches/${normalizedQuery}`).set({
  query: originalQuery,
  songs: cleanedSongs.map((s, i) => ({ ...s, rank: i + 1, songId: null })),
  mixes: cleanedMixes.map((m, i) => ({ ...m, rank: i + 1 })),
  videos: cleanedVideos.map((v, i) => ({ ...v, rank: i + 1 })),
  artists: cleanedArtists.map((a, i) => ({ ...a, rank: i + 1, artistId: null })),
  lastUpdated: new Date(),
  createdAt: new Date()
});
```

### 6. Enrich Results
For each cached result:
- **Songs**: If `songId` exists → fetch full data from `songs/{songId}` (includes artistId, albumId, genre, tags)
- **Artists**: If `artistId` exists → fetch full data from `artists/{artistId}` (includes followerCount, imageUrl)
- Preserve rank order

### 7. Return Response
Return enriched results in format above

## Scheduled Update Job

**Purpose:** Keep cached searches fresh and link to newly synced songs/artists

**Frequency:** Daily or weekly

**Process:**
1. Query all `youtube_searches` where `lastUpdated < 7 days ago`
2. For each search:
   - Extract all `youtubeId` values from songs
   - Query `songs` collection: `where('youtubeId', 'in', youtubeIds)`
   - Update `songId` references in cached search
   - Extract all artist names
   - Query `artists` collection: `where('nameLower', 'in', artistNames)`
   - Update `artistId` references
   - Update `lastUpdated` timestamp
3. For very stale searches (> 30 days):
   - Re-run YouTube search + Gemini cleaning
   - Update entire cache entry

## Benefits

1. **Zero YouTube API quota** for repeated searches
2. **Instant results** for popular searches (no YouTube or Gemini calls)
3. **Clean data** from first search onwards
4. **Automatic enrichment** as songs/artists get synced
5. **Relevance preserved** via rank ordering
6. **Fresh data** via scheduled updates

## Implementation Tasks

### Phase 1: Core Search Endpoint
- [ ] Create DTO: `SearchYouTubeDto` with `query` field
- [ ] Create response DTOs for songs/mixes/videos/artists
- [ ] Add `searchYouTube()` method to `SongsService`
- [ ] Add cache check logic (query Firestore by normalized query)
- [ ] Add YouTube search call (reuse `YouTubeService`)
- [ ] Add Gemini classification prompt and parsing
- [ ] Add Firestore save logic for search results
- [ ] Add enrichment logic (fetch full song/artist data if linked)
- [ ] Add controller endpoint: `POST /songs/search-youtube`
- [ ] Test with various queries (songs, artists, mixes)

### Phase 2: Scheduled Updates
- [ ] Create scheduled job service for cache updates
- [ ] Add logic to find stale searches (> 7 days)
- [ ] Add logic to link songs by youtubeId
- [ ] Add logic to link artists by name
- [ ] Add logic to refresh very old searches (> 30 days)
- [ ] Test scheduled job manually
- [ ] Configure cron schedule

### Phase 3: Optimization
- [ ] Add pagination support for large result sets
- [ ] Monitor cache hit rate
- [ ] Monitor YouTube API quota usage
- [ ] Add error handling for Gemini failures
- [ ] Add fallback to raw YouTube data if Gemini fails
- [ ] Add logging for debugging

## Notes

- Normalize query for cache key: lowercase, trim, remove special chars
- Rate limit Gemini calls (5 sec between calls, 12 RPM)
- Handle Gemini failures gracefully (return raw YouTube data)
- Consider pagination for large result sets
- Monitor cache hit rate and YouTube API usage
- Cache freshness: 7 days for normal updates, 30 days for full refresh
