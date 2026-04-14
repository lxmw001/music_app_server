# Requirements Document

## Introduction

A NestJS-based REST API for a music application. The API provides search and suggestion endpoints across songs, artists, albums, and playlists. It uses Firebase for user authentication and file storage, YouTube as the playback source (referenced by video ID), and a custom-built database populated via a Gemini-powered sync process. The sync runs on a daily schedule and can also be triggered manually via a protected admin endpoint. The system does not handle audio streaming directly; the client app constructs playback URLs from the YouTube video ID returned by the API.

## Glossary

- **API**: The NestJS application exposing HTTP endpoints to clients.
- **User**: An authenticated individual interacting with the API.
- **Song**: A music track with metadata (title, artist, album, duration, YouTube video ID).
- **Artist**: A musical performer or group with associated songs and albums.
- **Album**: A collection of songs released together by an artist.
- **Playlist**: A user-curated ordered collection of songs.
- **Firebase_Auth**: Firebase Authentication service used to verify user identity.
- **Firebase_Storage**: Firebase Cloud Storage used to store media assets (e.g. cover images).
- **Search_Engine**: The internal module responsible for querying the database across all entity types.
- **Suggestion_Engine**: The internal module responsible for generating search suggestions based on partial input.
- **Seeder**: The sync process that populates and refreshes the database with artists, songs, albums, and playlists. Can be triggered manually via a protected endpoint or runs automatically on a schedule.
- **Sync**: The full pipeline that uses Gemini AI to generate search queries, executes them against the YouTube Data API, processes results, and stores resolved data in Firestore.
- **YouTube_ID**: A YouTube video identifier (e.g. `dQw4w9WgXcQ`) stored per song. The client app constructs the full playback URL from this identifier; the API stores and returns only the ID.
- **Gemini_AI**: Google Gemini AI service used to rank, organize, and disambiguate YouTube search results.
- **YouTube_Search_Result**: A candidate video returned by the YouTube search API for a given song query.
- **Duplicate_Candidate**: Two or more YouTube search results that share a similar title or artist name but may differ in quality, authenticity, or relevance.
- **Genre_Input**: A genre string (e.g. "Rock", "Pop", "Jazz") supplied by the caller as the primary input to the sync pipeline. The pipeline uses each genre to discover artists via Gemini AI. If no genres are provided, the pipeline auto-discovers popular genres via `GeminiService.getPopularGenres()`.
- **Artist_Rank**: A numeric relevance/popularity rank assigned by Gemini AI to an artist within a genre result list (1 = most relevant). Used to prioritise which artists are processed first during the sync.
- **Cleaned_Song_Result**: A normalized, deduplicated song entry produced by `GeminiService.cleanAndDeduplicate()` after all YouTube searches are complete. Contains a clean title, artist name, optional album name, genre, artist rank, YouTube ID, and optional duration. Duplicate songs (same title + artist) are merged into a single entry with the best YouTube result selected.
- **Genre_Playlist**: A system-generated playlist that groups songs by musical genre (e.g. "Rock", "Pop"). The genre is known from the sync input, not derived after the fact. Genre playlists are not owned by any user (`ownerUid` is null / a system sentinel value).
- **Album_Playlist**: A system-generated playlist that groups all songs from a specific album in track order. Album playlists are not owned by any user (`ownerUid` is null / a system sentinel value).

---

## Requirements

### Requirement 1: User Authentication

**User Story:** As a user, I want to sign in with my Firebase account, so that I can access protected API endpoints.

#### Acceptance Criteria

1. WHEN a request includes a valid Firebase ID token in the Authorization header, THE API SHALL authenticate the user and allow access to protected endpoints.
2. WHEN a request includes an invalid or expired Firebase ID token, THE API SHALL return an HTTP 401 Unauthorized response.
3. WHEN a request to a protected endpoint is made without an Authorization header, THE API SHALL return an HTTP 401 Unauthorized response.
4. THE Firebase_Auth SHALL be the sole authentication provider for the API.

---

### Requirement 2: Search Across All Entity Types

**User Story:** As a user, I want to search for any music-related content in a single query, so that I can find songs, artists, albums, and playlists at once.

#### Acceptance Criteria

1. WHEN a search request is received with a non-empty query string, THE Search_Engine SHALL return matching results grouped by entity type: songs, artists, albums, and playlists.
2. WHEN a search request is received, THE Search_Engine SHALL perform case-insensitive matching against entity names and relevant metadata.
3. WHEN a search query matches no entities, THE Search_Engine SHALL return an empty result set for each entity type with an HTTP 200 response.
4. WHEN a search request is received with an empty or whitespace-only query string, THE API SHALL return an HTTP 400 Bad Request response.
5. THE Search_Engine SHALL return results within 500ms for datasets up to 100,000 entities.

---

### Requirement 3: Search Suggestions

**User Story:** As a user, I want to receive search suggestions as I type, so that I can quickly find what I am looking for.

#### Acceptance Criteria

1. WHEN a suggestion request is received with a partial query of at least 2 characters, THE Suggestion_Engine SHALL return up to 10 matching suggestions across all entity types.
2. WHEN a suggestion request is received with a query shorter than 2 characters, THE API SHALL return an HTTP 400 Bad Request response.
3. THE Suggestion_Engine SHALL return suggestions within 200ms for datasets up to 100,000 entities.
4. THE Suggestion_Engine SHALL rank suggestions by relevance, prioritizing prefix matches over substring matches.

---

### Requirement 4: Song Management

**User Story:** As a user, I want to retrieve song details, so that I can view metadata and access the YouTube video ID for playback.

#### Acceptance Criteria

1. WHEN a request is made for a specific song by its identifier, THE API SHALL return the song's title, artist, album, duration, cover image URL, and YouTube_ID.
2. WHEN a request is made for a song identifier that does not exist, THE API SHALL return an HTTP 404 Not Found response.
3. THE API SHALL expose an endpoint to list songs with pagination support (page number and page size parameters).
4. WHEN a list songs request is received without pagination parameters, THE API SHALL default to page 1 with a page size of 20.

---

### Requirement 5: Artist Management

**User Story:** As a user, I want to browse artist profiles, so that I can discover their songs and albums.

#### Acceptance Criteria

1. WHEN a request is made for a specific artist by identifier, THE API SHALL return the artist's name, biography, profile image URL, and associated album identifiers.
2. WHEN a request is made for an artist identifier that does not exist, THE API SHALL return an HTTP 404 Not Found response.
3. THE API SHALL expose an endpoint to list all songs belonging to a specific artist.
4. THE API SHALL expose an endpoint to list all albums belonging to a specific artist.

---

### Requirement 6: Album Management

**User Story:** As a user, I want to browse albums, so that I can view their track listings.

#### Acceptance Criteria

1. WHEN a request is made for a specific album by identifier, THE API SHALL return the album's title, artist, release year, cover image URL, and ordered list of song identifiers.
2. WHEN a request is made for an album identifier that does not exist, THE API SHALL return an HTTP 404 Not Found response.
3. THE API SHALL expose an endpoint to list albums with pagination support.

---

### Requirement 7: Playlist Management

**User Story:** As a user, I want to create and manage playlists, so that I can organize songs I enjoy.

#### Acceptance Criteria

1. WHEN an authenticated user submits a create playlist request with a name and optional description, THE API SHALL create a new playlist associated with that user and return the created playlist with an HTTP 201 response.
2. WHEN an authenticated user requests their playlists, THE API SHALL return only the playlists owned by that user.
3. WHEN an authenticated user adds a valid song identifier to an existing playlist they own, THE API SHALL append the song to the playlist and return the updated playlist.
4. WHEN an authenticated user removes a song from a playlist they own, THE API SHALL remove the song and return the updated playlist.
5. WHEN an authenticated user deletes a playlist they own, THE API SHALL delete the playlist and return an HTTP 204 No Content response.
6. WHEN a request is made to modify or delete a playlist owned by a different user, THE API SHALL return an HTTP 403 Forbidden response.
7. WHEN a request is made to add a song identifier that does not exist to a playlist, THE API SHALL return an HTTP 404 Not Found response.

---

### Requirement 8: Firebase Storage Integration

**User Story:** As a developer, I want cover images stored in Firebase Storage, so that the API can serve consistent media URLs.

#### Acceptance Criteria

1. THE API SHALL store and retrieve cover image URLs from Firebase_Storage for songs, artists, and albums.
2. WHEN a cover image URL is requested for an entity, THE API SHALL return a valid, publicly accessible Firebase_Storage URL.
3. IF a cover image is not available for an entity, THEN THE API SHALL return a designated placeholder image URL.

---

### Requirement 9: Gemini-Powered Data Sync

**User Story:** As a developer, I want a sync process that uses Gemini AI to discover and populate music data for a given list of artists, so that the database is populated with relevant artists, songs, and albums linked to YouTube videos and automatically organized into playlists.

#### Acceptance Criteria

1. WHEN the Sync is executed, THE Sync SHALL accept a list of genres as input; for each genre, THE Sync SHALL call `GeminiService.getArtistsForGenre(genre)` to obtain a ranked list of notable artists for that genre, and SHALL then use those artists as the basis for YouTube search query generation.
1a. WHEN `GeminiService.getArtistsForGenre(genre)` is called, THE Gemini_AI SHALL return a ranked list of artists for that genre; each entry in the list SHALL include a `name` (string) and a `rank` (number, where 1 = most relevant), and MAY include a `topSongs` array of suggested song title strings.
1b. WHEN the Sync is executed with no genres provided (empty or absent `genres` array), THE Sync SHALL call `GeminiService.getPopularGenres()` at the very beginning to obtain a list of popular music genres (e.g. "Rock", "Pop", "Hip-Hop", "Jazz", "Classical"), and SHALL use the returned genres as the input genres for the rest of the pipeline — identical to the behaviour when genres are supplied manually.
1c. AFTER all YouTube searches are completed for all artists across all genres, THE Sync SHALL call `GeminiService.cleanAndDeduplicate(rawResults)` with the full batch of collected raw song/artist/video data before proceeding to ranking/disambiguation and persistence. THE Gemini_AI SHALL return a cleaned, deduplicated list of `Cleaned_Song_Result` entries where: song names are normalized (e.g. "(Official Video)", "(Lyrics)", "(ft. ...)" suffixes removed, casing fixed); artist names are normalized (consistent casing, featuring info removed from the artist field); duplicate songs (same title + artist, different YouTube results) are merged into a single entry with the best YouTube result selected; each entry carries the `genre` from the input genre that triggered discovery and the `artistRank` inherited from the artist's rank within its genre.
2. WHEN the Sync executes a generated search query, THE Sync SHALL call the YouTube Data API v3 and collect the returned video results.
3. WHEN the Sync has collected YouTube search results, THE Sync SHALL use Gemini_AI to rank and disambiguate results (per Requirements 10 and 11) and resolve each entry to a single YouTube_ID.
4. WHEN the Sync resolves a song entry, THE Sync SHALL store the song, its associated artist, and album (if applicable) in Firestore with the resolved YouTube_ID.
5. WHEN the Sync is executed against a database that already contains data, THE Sync SHALL skip duplicate entries based on a unique identifier (e.g. name + artist combination for songs) — running the Sync twice SHALL produce the same document counts as running it once.
6. THE Sync SHALL associate cover images with artists, songs, and albums using Firebase_Storage URLs.
7. WHEN the Sync encounters an error processing a record, THE Sync SHALL log the error and continue processing remaining records.
8. WHEN the Sync processes a YouTube search query, THE Sync SHALL store the query string and its results in Firestore under a `/syncCache/{queryHash}` document so that the same search is not re-executed on subsequent runs.
9. WHEN the Sync is about to execute a YouTube search query, THE Sync SHALL first check whether a cached result exists in `/syncCache/{queryHash}`; IF a cached result exists AND the sync is not running in force mode, THE Sync SHALL reuse the stored result and SHALL NOT call the YouTube Data API for that query.
10. WHEN the Sync is executed with `force=true`, THE Sync SHALL ignore all cached results in `/syncCache`, re-execute all YouTube searches from scratch, and overwrite the stored results in Firestore.
11. WHEN the Sync resolves a song, THE Sync SHALL add the song to the Genre_Playlist corresponding to the genre that triggered its discovery (i.e. the input genre that led to the artist being discovered), creating the playlist if it does not already exist. Genre classification via Gemini_AI is NOT required for songs discovered through genre-first input — the genre is already known from the input.
12. WHEN the Sync resolves all songs for an album, THE Sync SHALL create or update an Album_Playlist containing all songs from that album in track order.
13. WHEN adding a song to a Genre_Playlist or Album_Playlist that already exists, THE Sync SHALL NOT add the song if it is already present in that playlist (no duplicates).
14. Genre_Playlists and Album_Playlists created by the Sync SHALL have `ownerUid` set to `null` (system-generated) and SHALL NOT be modifiable by regular users.

---

### Requirement 9a: Scheduled Daily Sync

**User Story:** As a developer, I want the sync to run automatically every day, so that the music database stays up to date without manual intervention.

#### Acceptance Criteria

1. THE system SHALL run the Sync automatically once per day using a scheduled cron job.
2. THE scheduled job SHALL be implemented using `@nestjs/schedule` with a cron expression.
3. WHEN the scheduled Sync runs, it SHALL follow the same pipeline as a manually triggered Sync (Requirements 9.1–9.10).
4. WHEN the scheduled Sync fails, THE system SHALL log the error and not crash the application.
5. THE scheduled Sync SHALL NOT use `force=true` by default — it SHALL reuse cached results from `/syncCache` where available.

---

### Requirement 9b: Manual Sync Trigger Endpoint

**User Story:** As an admin, I want to trigger the sync manually via a REST endpoint, so that I can populate or refresh the database on demand (e.g. for initial data population).

#### Acceptance Criteria

1. THE API SHALL expose a `POST /sync/trigger` endpoint that initiates the Sync pipeline.
2. THE `POST /sync/trigger` endpoint SHALL be protected and accessible only to authenticated users with an admin role.
3. WHEN a non-admin authenticated user calls `POST /sync/trigger`, THE API SHALL return an HTTP 403 Forbidden response.
4. WHEN an unauthenticated request is made to `POST /sync/trigger`, THE API SHALL return an HTTP 401 Unauthorized response.
5. WHEN the Sync is triggered via the endpoint, THE API SHALL return an HTTP 202 Accepted response immediately and run the Sync asynchronously.
6. THE `POST /sync/trigger` endpoint SHALL accept a JSON request body of the form `{ "genres": ["Genre 1", "Genre 2"], "force": false }`; the `genres` array is optional and defaults to an empty array — when empty or absent, the Sync auto-discovers popular genres via `GeminiService.getPopularGenres()` (per Requirement 9.1b); `force` is optional and defaults to `false`.
7. WHEN `force` is `true` in the request body, THE Sync SHALL bypass all cached results and re-execute all searches from scratch (per Requirement 9.10).
8. WHEN `POST /sync/trigger` is called without the `force` field (or with `force: false`), THE Sync SHALL reuse cached results where available (per Requirement 9.9).

---

### Requirement 10: Gemini AI — Search Query Generation and YouTube Result Ranking

**User Story:** As a developer, I want Gemini AI to generate YouTube search queries and rank search results for songs, so that the most relevant and highest-quality video is selected for playback.

#### Acceptance Criteria

1. WHEN the Sync is initiated, THE Gemini_AI SHALL generate a list of YouTube search queries based on a seed list or context describing the desired music content (e.g. genre, era, artist names).
1a. WHEN given a genre string, THE Gemini_AI SHALL return a ranked list of notable artists for that genre via `getArtistsForGenre`; each result SHALL include a `name` and a `rank`, and MAY include a `topSongs` array.
1b. WHEN called with no arguments, THE Gemini_AI SHALL return a list of popular music genre strings via `getPopularGenres` (e.g. "Rock", "Pop", "Hip-Hop", "Jazz", "Classical"); the returned value SHALL be a non-empty `string[]`.
1c. WHEN called with the full batch of raw YouTube search results, THE Gemini_AI SHALL return a cleaned, deduplicated list of `Cleaned_Song_Result` entries via `cleanAndDeduplicate`; normalized song and artist names SHALL have common suffix noise removed and casing corrected; duplicate entries (same normalized title + normalized artist) SHALL be merged into a single entry with the best YouTube result selected.
2. WHEN the Sync or API retrieves YouTube search results for a song query, THE Gemini_AI SHALL rank the YouTube_Search_Results by relevance using the song title, artist name, and album as ranking context.
3. WHEN Gemini_AI ranks YouTube_Search_Results, THE Gemini_AI SHALL consider factors including title match accuracy, channel authenticity (official artist channels preferred), and video duration proximity to the known song duration.
4. WHEN Gemini_AI returns a ranked list, THE API SHALL select the highest-ranked YouTube_Search_Result and store its YouTube_ID for the song.
5. WHEN the Gemini_AI service is unavailable, THE API SHALL fall back to selecting the first YouTube_Search_Result returned by YouTube, store its YouTube_ID, and log a warning.
6. IF no YouTube_Search_Results are returned for a query, THEN THE API SHALL log the failure and leave the YouTube_ID field empty for that song.

---

### Requirement 11: Gemini AI — Duplicate Song Disambiguation

**User Story:** As a developer, I want Gemini AI to resolve duplicate song or artist name conflicts in YouTube search results, so that the correct version of a song is associated with each entry.

#### Acceptance Criteria

1. WHEN two or more YouTube_Search_Results are identified as Duplicate_Candidates for the same song, THE Gemini_AI SHALL evaluate each candidate and select the single best match based on the song's known metadata (title, artist, album, duration).
2. WHEN evaluating Duplicate_Candidates, THE Gemini_AI SHALL prefer results from verified or official artist channels over user-uploaded content.
3. WHEN evaluating Duplicate_Candidates with identical channel authority, THE Gemini_AI SHALL prefer the result whose video duration is closest to the song's known duration.
4. WHEN Gemini_AI resolves a duplicate, THE API SHALL store only the selected YouTube_ID and discard the remaining candidates.
5. IF Gemini_AI cannot determine a best match among Duplicate_Candidates, THEN THE API SHALL flag the song for manual review and leave the YouTube_ID field empty.

---

### Requirement 12: API Error Handling

**User Story:** As a developer, I want consistent error responses, so that clients can handle failures predictably.

#### Acceptance Criteria

1. WHEN an unhandled exception occurs, THE API SHALL return an HTTP 500 Internal Server Error response with a generic error message.
2. THE API SHALL return all error responses in a consistent JSON structure containing a `statusCode`, `message`, and `timestamp` field.
3. WHEN a request body fails validation, THE API SHALL return an HTTP 400 Bad Request response listing all validation errors.
