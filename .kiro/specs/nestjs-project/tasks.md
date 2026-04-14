# Implementation Plan: NestJS Music API

## Overview

Incremental implementation of the NestJS Music API — starting with project scaffolding and shared infrastructure, then building each feature module, and finishing with the sync pipeline and property-based tests.

## Tasks

- [x] 1. Scaffold project and shared infrastructure
  - Initialize a NestJS project with `@nestjs/cli`
  - Install dependencies: `firebase-admin`, `@nestjs/schedule`, `@nestjs/cache-manager`, `cache-manager`, `class-validator`, `class-transformer`, `@google/generative-ai`, `axios`
  - Create `src/main.ts` with global `ValidationPipe` and `HttpExceptionFilter`
  - Create `src/app.module.ts` importing all feature modules
  - _Requirements: 1.4, 12.1, 12.2, 12.3_

- [x] 2. Implement Firebase Admin and Auth infrastructure
  - [x] 2.1 Create `src/auth/firebase-admin.service.ts` that initialises the Firebase Admin SDK from environment variables
    - Expose the `app` instance for use by other services
    - _Requirements: 1.1, 1.4_
  - [x] 2.2 Create `src/auth/firebase-auth.guard.ts` that verifies the `Authorization: Bearer <token>` header via Firebase Admin SDK
    - Attach `{ uid, email }` to `req.user` on success
    - Throw `UnauthorizedException` on invalid/missing token
    - _Requirements: 1.1, 1.2, 1.3_
  - [ ]* 2.3 Write property test for FirebaseAuthGuard (P16 — admin guard rejects non-admin tokens)
    - **Property 16: Admin guard rejects non-admin users**
    - **Validates: Requirements 9b.2, 9b.3**

- [x] 3. Implement shared Firestore and Storage services
  - [x] 3.1 Create `src/firestore/firestore.service.ts` wrapping the Admin Firestore instance with `collection()` and `doc()` helpers
    - _Requirements: 9.4_
  - [x] 3.2 Create `src/firestore/firestore.module.ts` exporting `FirestoreService`
  - [x] 3.3 Create `src/storage/firebase-storage.service.ts` for uploading/retrieving cover image URLs
    - Return a placeholder URL when no image is available
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 4. Implement global error handling and common DTOs
  - [x] 4.1 Create `src/common/filters/http-exception.filter.ts` returning `{ statusCode, message, timestamp }` for all errors
    - Handle `HttpException`, `ValidationError`, and unknown errors
    - _Requirements: 12.1, 12.2, 12.3_
  - [x] 4.2 Create `src/common/dto/error-response.dto.ts` and `src/common/pipes/validation.pipe.ts`
    - _Requirements: 12.2, 12.3_
  - [ ]* 4.3 Write property test for error response structure invariant (P10)
    - **Property 10: Error response structure invariant**
    - **Validates: Requirements 12.2, 12.3**

- [x] 5. Implement Cache module and key helpers
  - [x] 5.1 Create `src/cache/cache.module.ts` registering `@nestjs/cache-manager` with in-memory store (`max: 1000`)
    - Mark module `@Global()` so all feature modules can inject `CACHE_MANAGER`
    - _Requirements: (Caching Strategy)_
  - [x] 5.2 Create `src/cache/cache-keys.ts` with `CacheKeys` helpers for `suggestion`, `search`, `song`, `artist`, `album`
    - _Requirements: (Caching Strategy)_
  - [ ]* 5.3 Write property test for cache read idempotence (P12)
    - **Property 12: Cache read idempotence**
    - **Validates: Caching Strategy — suggestions TTL, search TTL, entity TTL**

- [x] 6. Checkpoint — Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement Songs module
  - [x] 7.1 Create `src/songs/songs.service.ts` with `findById` (cache-through) and `findAll` (paginated) methods
    - Use `CacheKeys.song(id)` with 300 s TTL
    - Throw `NotFoundException` when document does not exist
    - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - [x] 7.2 Create `src/songs/dto/` with `PaginationDto` and response DTOs
    - _Requirements: 4.3, 4.4_
  - [x] 7.3 Create `src/songs/songs.controller.ts` exposing `GET /songs` and `GET /songs/:id` behind `FirebaseAuthGuard`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 8. Implement Artists module
  - [x] 8.1 Create `src/artists/artists.service.ts` with `findById`, `findAll`, `findSongs`, and `findAlbums` methods
    - Use `CacheKeys.artist(id)` with 300 s TTL
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [x] 8.2 Create `src/artists/artists.controller.ts` exposing `GET /artists`, `GET /artists/:id`, `GET /artists/:id/songs`, `GET /artists/:id/albums`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 9. Implement Albums module
  - [x] 9.1 Create `src/albums/albums.service.ts` with `findById` and `findAll` methods
    - Use `CacheKeys.album(id)` with 300 s TTL
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 9.2 Create `src/albums/albums.controller.ts` exposing `GET /albums` and `GET /albums/:id`
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 10. Implement Playlists module
  - [x] 10.1 Create `src/playlists/playlists.service.ts` with `create`, `findAllForUser`, `addSong`, `removeSong`, and `delete` methods
    - Filter on `ownerUid == currentUser.uid` for listings (excludes system playlists)
    - Throw `ForbiddenException` when the requesting user does not own the playlist
    - Throw `NotFoundException` when song or playlist does not exist
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - [x] 10.2 Create `src/playlists/playlists.controller.ts` exposing all playlist endpoints
    - `POST /playlists` → 201, `GET /playlists`, `DELETE /playlists/:id` → 204
    - `POST /playlists/:id/songs`, `DELETE /playlists/:id/songs/:songId`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - [ ]* 10.3 Write property test for playlist ownership isolation (P7)
    - **Property 7: Playlist ownership isolation**
    - **Validates: Requirements 7.2**
  - [ ]* 10.4 Write property test for playlist mutation authorization (P8)
    - **Property 8: Playlist mutation authorization**
    - **Validates: Requirements 7.6**
  - [ ]* 10.5 Write property test for playlist song add/remove round trip (P9)
    - **Property 9: Playlist song add/remove round trip**
    - **Validates: Requirements 7.3, 7.4**
  - [ ]* 10.6 Write property test for cache invalidation on mutation (P13)
    - **Property 13: Cache invalidation on mutation**
    - **Validates: Caching Strategy — cache invalidation on playlist mutation**

- [x] 11. Checkpoint — Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement Search module
  - [x] 12.1 Create `src/search/search.service.ts` performing prefix + `array-contains` queries across all four collections
    - Use `CacheKeys.search(q)` with 30 s TTL
    - Reject empty/whitespace queries with `BadRequestException`
    - Return `{ songs, artists, albums, playlists }` always (empty arrays when no match)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 12.2 Create `src/search/search.controller.ts` exposing `GET /search?q=` behind `FirebaseAuthGuard`
    - Validate `q` with `SearchQueryDto`
    - _Requirements: 2.1, 2.4_
  - [ ]* 12.3 Write property test for search result shape invariant (P1)
    - **Property 1: Search result shape invariant**
    - **Validates: Requirements 2.1, 2.3**
  - [ ]* 12.4 Write property test for search case-insensitivity (P2)
    - **Property 2: Search case-insensitivity**
    - **Validates: Requirements 2.2**
  - [ ]* 12.5 Write property test for whitespace/empty query rejection (P3)
    - **Property 3: Whitespace/empty query rejection**
    - **Validates: Requirements 2.4**

- [x] 13. Implement Suggestions module
  - [x] 13.1 Create `src/suggestions/suggestions.service.ts` with prefix-ranked suggestions across all entity types
    - Use `CacheKeys.suggestion(q)` with 60 s TTL
    - Enforce minimum query length of 2 characters (`BadRequestException` otherwise)
    - Cap results at 10 items; rank prefix matches before substring matches
    - _Requirements: 3.1, 3.2, 3.4_
  - [x] 13.2 Create `src/suggestions/suggestions.controller.ts` exposing `GET /suggestions?q=`
    - Validate `q` with `SuggestionQueryDto`
    - _Requirements: 3.1, 3.2_
  - [ ]* 13.3 Write property test for suggestion minimum length enforcement (P4)
    - **Property 4: Suggestion minimum length enforcement**
    - **Validates: Requirements 3.2**
  - [ ]* 13.4 Write property test for suggestion count upper bound (P5)
    - **Property 5: Suggestion count upper bound**
    - **Validates: Requirements 3.1**
  - [ ]* 13.5 Write property test for suggestion prefix ranking (P6)
    - **Property 6: Suggestion prefix ranking**
    - **Validates: Requirements 3.4**

- [x] 14. Checkpoint — Ensure all tests pass, ask the user if questions arise.

- [x] 15. Implement Sync — GeminiService
  - [x] 15.1 Create `src/sync/gemini.service.ts` with the following methods:
    - `getPopularGenres(): Promise<string[]>` — returns a non-empty list of genre strings
    - `getArtistsForGenre(genre: string): Promise<GeminiArtistResult[]>` — returns ranked artists with unique ranks
    - `generateSearchQueries(artistName: string, topSongs?: string[]): Promise<string[]>` — returns non-empty string array
    - `cleanAndDeduplicate(rawResults: YouTubeSearchResult[]): Promise<CleanedSongResult[]>` — normalizes and deduplicates
    - `rankAndDisambiguate(results: YouTubeSearchResult[], context: object): Promise<string>` — returns best videoId; falls back to first result if Gemini unavailable
    - _Requirements: 9.1, 9.1a, 9.1b, 9.1c, 10.1, 10.1a, 10.1b, 10.1c, 10.2, 10.3, 10.4, 10.5, 11.1, 11.2, 11.3_
  - [ ]* 15.2 Write property test for sync query generation (P14)
    - **Property 14: Sync query generation produces non-empty queries**
    - **Validates: Requirements 9.1, 10.1**
  - [ ]* 15.3 Write property test for Gemini artist ranks uniqueness (P22)
    - **Property 22: Gemini artist ranks are unique within a genre result**
    - **Validates: Requirements 9.1a, 10.1a**
  - [ ]* 15.4 Write property test for auto genre discovery (P23)
    - **Property 23: Auto genre discovery uses getPopularGenres output**
    - **Validates: Requirements 9.1b, 10.1b**
  - [ ]* 15.5 Write property test for cleaned results deduplication (P24)
    - **Property 24: Cleaned results have no duplicate (title + artist) pairs**
    - **Validates: Requirements 9.1c, 10.1c**
  - [ ]* 15.6 Write property test for CleanedSongResult fields (P25)
    - **Property 25: Every CleanedSongResult has a non-empty genre and positive artistRank**
    - **Validates: Requirements 9.1c, 10.1c**

- [x] 16. Implement Sync — YouTubeService
  - [x] 16.1 Create `src/sync/youtube.service.ts` calling the YouTube Data API v3 `search.list` endpoint
    - Return `YouTubeSearchResult[]` (videoId, title, channelTitle, duration)
    - _Requirements: 9.2_
  - [ ]* 16.2 Write property test for ranking selection (P15)
    - **Property 15: Ranking selection picks highest-ranked result**
    - **Validates: Requirements 10.4**

- [x] 17. Implement Sync — SyncService and AdminGuard
  - [x] 17.1 Create `src/sync/sync.service.ts` orchestrating the full pipeline:
    - Auto genre discovery when `genres` is empty/absent (call `getPopularGenres()` once)
    - Per-genre artist discovery → per-artist query generation → cache check → YouTube search → cache write
    - Batch `cleanAndDeduplicate` call after all searches complete
    - `rankAndDisambiguate` per cleaned result
    - Deduplication check before Firestore upsert (skip existing name+artist combos)
    - Genre playlist upsert (no duplicates, `ownerUid: null`, `type: "genre"`)
    - Album playlist upsert in track order (no duplicates, `ownerUid: null`, `type: "album"`)
    - Per-record error catch + log; summary log on completion
    - _Requirements: 9.1, 9.1b, 9.1c, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11, 9.12, 9.13, 9.14_
  - [x] 17.2 Create `src/sync/admin.guard.ts` extending `FirebaseAuthGuard`
    - Check `req.user.admin === true`; return HTTP 403 if not present
    - _Requirements: 9b.2, 9b.3_
  - [ ]* 17.3 Write property test for sync idempotency (P11)
    - **Property 11: Sync idempotency**
    - **Validates: Requirements 9.5**
  - [ ]* 17.4 Write property test for sync cache bypass when force=false (P17)
    - **Property 17: Sync cache bypass when force=false**
    - **Validates: Requirements 9.9**
  - [ ]* 17.5 Write property test for every resolved song in genre playlist (P18)
    - **Property 18: Every resolved song appears in the genre playlist for its input genre**
    - **Validates: Requirements 9.11**
  - [ ]* 17.6 Write property test for album playlist completeness (P19)
    - **Property 19: Album playlist completeness**
    - **Validates: Requirements 9.12**
  - [ ]* 17.7 Write property test for genre/album playlist membership idempotency (P20)
    - **Property 20: Genre and album playlist membership idempotency**
    - **Validates: Requirements 9.13**
  - [ ]* 17.8 Write property test for system-generated playlists have null ownerUid (P21)
    - **Property 21: System-generated playlists have null ownerUid**
    - **Validates: Requirements 9.14**

- [x] 18. Implement Sync — Controller and Scheduler
  - [x] 18.1 Create `src/sync/sync.controller.ts` exposing `POST /sync/trigger` behind `AdminGuard`
    - Accept `SyncRequestDto` body (`genres?: string[]`, `force?: boolean`)
    - Return HTTP 202 immediately; run `SyncService.runSync()` asynchronously
    - _Requirements: 9b.1, 9b.2, 9b.3, 9b.4, 9b.5, 9b.6, 9b.7, 9b.8_
  - [x] 18.2 Create `src/sync/sync.scheduler.ts` using `@Cron` from `@nestjs/schedule` for a daily run
    - Call `SyncService.runSync({ genres: [], force: false })`
    - Catch and log errors without crashing the process
    - _Requirements: 9a.1, 9a.2, 9a.3, 9a.4, 9a.5_
  - [x] 18.3 Create `src/sync/sync.module.ts` wiring `SyncController`, `SyncService`, `SyncScheduler`, `GeminiService`, `YouTubeService`

- [x] 19. Checkpoint — Ensure all tests pass, ask the user if questions arise.

- [x] 20. Wire everything together in AppModule
  - [x] 20.1 Import all feature modules into `src/app.module.ts`
    - Include `ScheduleModule.forRoot()`, `CacheModule`, `FirestoreModule`, and all feature modules
    - Register `HttpExceptionFilter` and `ValidationPipe` globally in `main.ts`
    - _Requirements: 1.4, 12.1, 12.2, 12.3_
  - [ ]* 20.2 Write integration tests for auth guard, CRUD happy paths, and 404/403 scenarios using `@nestjs/testing` + `supertest`
    - Mock `FirestoreService` and Firebase Admin SDK via Jest module mocking
    - Verify cache integration: Firestore mock called only once across two identical requests
    - _Requirements: 1.1, 1.2, 1.3, 4.1, 4.2, 5.1, 5.2, 6.1, 6.2, 7.1–7.7_

- [x] 21. Final checkpoint — Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use **fast-check** with a minimum of 100 iterations; all Firestore and cache interactions are mocked
- Each property test file must include the tag `// Feature: nestjs-project, Property <N>: <property_text>`
- Playlists are never cached — they must always reflect the latest Firestore state
- System-generated playlists (`type: "genre"` or `"album"`) always have `ownerUid: null` and are excluded from user playlist listings
