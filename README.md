# NestJS Music API

A RESTful backend for a music application powered by Firebase, YouTube Data API, Gemini AI, and Last.fm. Deployed on Google Cloud Run.

**Production URL:** `https://music-app-server-lupbg4y2ha-uc.a.run.app`

---

## Table of Contents

- [Architecture](#architecture)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Environment Variables](#environment-variables)
- [Getting Started](#getting-started)
- [API Reference](#api-reference)
- [Sync Pipeline](#sync-pipeline)
- [YouTube Search & Caching](#youtube-search--caching)
- [Authentication](#authentication)
- [Testing](#testing)
- [Deployment](#deployment)
- [Utilities](#utilities)

---

## Architecture

```
Client → Firebase Auth → NestJS API → Firestore (data)
                                    → Firebase Storage (images)
                                    → YouTube Data API (video search)
                                    → Gemini AI (classification, cleaning)
                                    → Last.fm API (metadata enrichment)
```

All data is stored in **Firebase Firestore**. No SQL database is used.

### Firestore Collections

| Collection | Description |
|------------|-------------|
| `songs` | Song documents with YouTube ID, metadata, genres, tags |
| `artists` | Artist profiles |
| `albums` | Album metadata |
| `playlists` | User playlists + system genre/album playlists |
| `youtube_searches` | Cached YouTube search results (7-day TTL) |
| `playlists_generated` | AI-generated song playlists (7-day TTL) |
| `syncCache` | Cached raw YouTube search results for the sync pipeline |

---

## Features

- **Songs** — CRUD, YouTube search with Gemini AI classification, trending music by country
- **Artists** — Browse profiles, list songs and albums
- **Albums** — Browse with pagination
- **Playlists** — User-managed playlists + system genre/album playlists auto-created by sync
- **Search** — Full-text search across all entity types with Firestore prefix + token queries
- **Suggestions** — Autocomplete with prefix-ranked results
- **Sync Pipeline** — Genre-first data population using Gemini AI + YouTube + Last.fm
- **YouTube Search Cache** — Server-side search with 7-day Firestore cache, fuzzy matching, Gemini classification
- **Trending Music** — YouTube trending videos by country, cleaned by Gemini, cached 6 hours
- **AI Playlist Generation** — Similar track recommendations via Last.fm + DB fallback
- **Metadata Enrichment** — Last.fm integration for album art, genres, tags, listener counts

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | NestJS 10 |
| Language | TypeScript 5 |
| Database | Firebase Firestore |
| Auth | Firebase Authentication |
| Storage | Firebase Cloud Storage |
| AI | Google Gemini AI (`gemini-1.5-flash`) |
| Video | YouTube Data API v3 |
| Music Metadata | Last.fm API |
| Cache | `@nestjs/cache-manager` (in-memory) |
| Scheduler | `@nestjs/schedule` (cron) |
| Testing | Jest 29, fast-check (PBT), supertest |
| Deployment | Google Cloud Run |
| CI/CD | GitHub Actions |

---

## Environment Variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `FIREBASE_PROJECT_ID` | ✅ | Firebase project ID |
| `FIREBASE_CLIENT_EMAIL` | ✅ | Firebase service account email |
| `FIREBASE_PRIVATE_KEY` | ✅ | Firebase service account private key |
| `YOUTUBE_API_KEY` | ✅ | YouTube Data API v3 key (primary) |
| `YOUTUBE_API_KEY_2` | ⬜ | YouTube API key #2 (auto-rotated on quota exceeded) |
| `YOUTUBE_API_KEY_3` | ⬜ | YouTube API key #3 (auto-rotated on quota exceeded) |
| `GEMINI_API_KEY` | ✅ | Google Gemini AI API key |
| `LASTFM_API_KEY` | ⬜ | Last.fm API key (metadata enrichment) |
| `SPOTIFY_CLIENT_ID` | ⬜ | Spotify client ID (optional enrichment) |
| `SPOTIFY_CLIENT_SECRET` | ⬜ | Spotify client secret (optional enrichment) |
| `PORT` | ⬜ | Server port (default: `3000`) |

> **YouTube API key rotation:** The service automatically rotates between `YOUTUBE_API_KEY`, `YOUTUBE_API_KEY_2`, and `YOUTUBE_API_KEY_3` when a quota exceeded error is detected.

---

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Install & Run

```bash
npm install
npm run start:dev
```

The API will be available at `http://localhost:3000`.

### Get a Firebase Token

Open `get-token.html` in a browser to sign in and copy your Firebase ID token for use in API requests.

---

## API Reference

All endpoints require a Firebase ID token in the `Authorization` header (except where noted as optional auth):

```
Authorization: Bearer <firebase-id-token>
```

### Songs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/songs` | optional | List songs (paginated) |
| `GET` | `/songs/:id` | optional | Get song by ID |
| `GET` | `/songs/trending?country=EC&limit=50` | optional | Trending music by country (cached 6h) |
| `GET` | `/songs/search-youtube?query=bad+bunny` | optional | Search YouTube with Gemini classification + Firestore cache |
| `POST` | `/songs/search-youtube` | optional | Same as GET (deprecated, use GET) |
| `GET` | `/songs/:id/generate-playlist?limit=30` | optional | AI-generated playlist based on a song |
| `POST` | `/songs/:id/refresh-metadata` | optional | Refresh Last.fm metadata for a song |
| `POST` | `/songs/submit-search` | optional | Submit YouTube results for Gemini cleaning and storage |
| `POST` | `/songs/clean-youtube-results` | optional | Clean raw YouTube results via Gemini |

#### YouTube Search Response

```json
{
  "songs": [
    {
      "id": "firestore-song-id",
      "title": "Tití Me Preguntó",
      "artistName": "Bad Bunny",
      "youtubeId": "abc123",
      "thumbnailUrl": "https://...",
      "duration": 245,
      "rank": 1,
      "genres": ["reggaeton", "latin"],
      "tags": ["reggaeton", "latin trap"],
      "album": "Un Verano Sin Ti",
      "listeners": 5000000
    }
  ],
  "mixes": [{ "title": "Bad Bunny Mix", "youtubeId": "xyz", "thumbnailUrl": "...", "rank": 1 }],
  "videos": [{ "title": "Behind the Scenes", "youtubeId": "def", "thumbnailUrl": "...", "rank": 1 }],
  "artists": [{ "name": "Bad Bunny", "rank": 1 }]
}
```

### Artists

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/artists` | ✅ | List artists (paginated) |
| `GET` | `/artists/:id` | ✅ | Get artist by ID |
| `GET` | `/artists/:id/songs` | ✅ | List artist's songs |
| `GET` | `/artists/:id/albums` | ✅ | List artist's albums |

### Albums

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/albums` | ✅ | List albums (paginated) |
| `GET` | `/albums/:id` | ✅ | Get album by ID |

### Playlists

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/playlists` | ✅ | List current user's playlists |
| `POST` | `/playlists` | ✅ | Create playlist |
| `DELETE` | `/playlists/:id` | ✅ | Delete playlist (owner only) |
| `POST` | `/playlists/:id/songs` | ✅ | Add song to playlist (owner only) |
| `DELETE` | `/playlists/:id/songs/:songId` | ✅ | Remove song from playlist (owner only) |

### Search & Suggestions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/search?q=rock` | ✅ | Search songs, artists, albums, playlists |
| `GET` | `/suggestions?q=ro` | ✅ | Autocomplete suggestions (min 2 chars) |

### Sync (Admin only)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/sync/trigger` | ✅ admin | Trigger data sync pipeline |

```json
// Request body
{
  "genres": ["Rock", "Pop"],  // optional — auto-discovers if empty
  "force": false              // true = bypass syncCache
}
```

### Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/admin/set-admin/:uid` | none | Set admin claim on a Firebase user |

> ⚠️ The `/admin/set-admin/:uid` endpoint has no auth guard — restrict access via Firebase Security Rules or remove in production.

---

## Sync Pipeline

Triggered via `POST /sync/trigger` (admin) or runs daily at 2am via cron.

```
1. Auto-discover genres (Gemini) if none provided
2. For each genre → get ranked artists (Gemini)
3. For each artist → generate YouTube search queries (Gemini)
4. Check syncCache (Firestore) — skip YouTube call if cached and force=false
5. YouTube search → store raw results in syncCache
6. Batch clean + deduplicate all results (Gemini)
7. Persist songs/artists/albums to Firestore
8. Upsert genre playlists (ownerUid: null, type: "genre")
9. Upsert album playlists (ownerUid: null, type: "album")
```

---

## YouTube Search & Caching

`GET /songs/search-youtube?query=bad+bunny`

```
1. Normalize query (lowercase, remove accents/special chars)
2. Check Firestore youtube_searches/{normalizedQuery}
3. If cache miss → fuzzy match against recent searches (85% similarity threshold)
4. If still miss → YouTube API search (20 results)
5. Gemini classifies results into: songs, mixes, videos, artists
6. Deduplicates songs (same title+artist, keeps shortest duration)
7. For new songs → Last.fm enrichment (album art, genres, tags, listeners)
8. Saves songs to songs collection, saves search to youtube_searches
9. Returns enriched results
```

**Cache TTL:** 7 days. Stale searches are refreshed daily at 3am (top 50 by search count).

---

## Authentication

The API uses Firebase Authentication. Include the ID token in every request:

```
Authorization: Bearer <firebase-id-token>
```

**Optional auth** — Songs endpoints use `OptionalAuthGuard`: requests without a token are allowed (useful for public browsing).

**Admin access** — Set the `admin: true` custom claim on a Firebase user:

```bash
# Using the shell script
./set-admin.sh

# Or via the API endpoint
POST /admin/set-admin/{uid}
```

---

## Testing

```bash
# Unit tests (77 tests)
npm run test:unit

# Integration tests (43 tests)
npm run test:integration

# Property-based tests (6 tests, 100 iterations each)
npm run test:pbt

# All tests
npm run test:all
```

### Postman

Import the included collections:
- `postman_collection.json` — all endpoints
- `postman_environment_local.json` — `http://localhost:3000`
- `postman_environment_production.json` — Cloud Run URL

---

## Deployment

### CI/CD (GitHub Actions)

| Branch | Workflow | Target |
|--------|----------|--------|
| `main` | `deploy-production.yml` | `music-api-prod` Cloud Run service |
| `develop` | `deploy-development.yml` | `music-api-dev` Cloud Run service |
| PRs / other branches | `ci.yml` | Tests only |

### Manual Deploy

```bash
# Build
npm run build

# Docker
docker build -t music-api .
docker run -p 3000:3000 --env-file .env music-api
```

### Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `GCP_PROJECT_ID` | GCP project ID |
| `GCP_REGION` | e.g. `us-central1` |
| `GCP_SA_KEY` | GCP service account JSON key |
| `PROD_FIREBASE_PROJECT_ID` | Production Firebase project ID |
| `PROD_FIREBASE_CLIENT_EMAIL` | Production Firebase client email |
| `PROD_YOUTUBE_API_KEY` | Production YouTube API key |
| `PROD_GEMINI_API_KEY` | Production Gemini API key |
| `DEV_*` | Same set for development environment |

---

## Utilities

| File | Purpose |
|------|---------|
| `get-token.html` | Browser tool to get a Firebase ID token for testing |
| `set-admin.sh` | Shell script to set admin claim on a Firebase user |
| `setup-secrets.sh` | Shell script to configure GCP Secret Manager and Cloud Run |
| `list-models.js` | Script to list available Gemini AI models |
| `postman_collection.json` | Postman collection for all API endpoints |
| `postman_environment_local.json` | Postman environment for local development |
| `postman_environment_production.json` | Postman environment for production |

---

## Scheduled Jobs

| Job | Schedule | Description |
|-----|----------|-------------|
| Sync pipeline | Daily at 2am | Refreshes music data from YouTube via Gemini |
| Search refresh | Daily at 3am | Refreshes stale YouTube search caches (>7 days, top 50 by popularity) |
