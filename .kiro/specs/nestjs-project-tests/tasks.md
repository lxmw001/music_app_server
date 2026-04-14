# Implementation Plan: NestJS Music API — Test Suite

## Overview

Implement a comprehensive test suite for the NestJS Music API covering unit tests, integration tests, and property-based tests. No application code is modified — all tasks involve creating test files and shared test utilities.

## Tasks

- [x] 1. Set up shared test infrastructure
  - Create `test/shared/mock-factories.ts` with `createMockFirestore`, `createMockCache`, `createMockFirebaseAdmin`, `createMockGemini`, `createMockYouTube` factory functions and all document helper factories (`makeSongDoc`, `makeArtistDoc`, `makeAlbumDoc`, `makePlaylistDoc`, `makeRawYouTubeResult`)
  - Create `test/shared/arbitraries.ts` with fast-check arbitraries: `arbRawYouTubeResult`, `arbRawYouTubeResultArray`, `arbNonEmptyString`, `arbHttpStatusCode`, `arbMessageString`
  - Create `test/shared/test-app.factory.ts` with `createTestApp()` that builds a `TestingModule` overriding `FirestoreService`, `CACHE_MANAGER`, `GeminiService`, `YouTubeService`, and `FirebaseAuthGuard` with the `MockFirebaseAuthGuard` that reads `x-test-user` header
  - Update `jest.config.js` (or `package.json`) to add three Jest projects: `unit` (`src/**/*.spec.ts`), `integration` (`test/**/*.e2e-spec.ts`), `pbt` (`test/**/*.pbt-spec.ts`) with `ts-jest` transform and `moduleNameMapper` for `src/` alias
  - Add `test:unit`, `test:integration`, `test:pbt`, and `test:all` scripts to `package.json`
  - _Requirements: 1–23 (foundational infrastructure)_

- [x] 2. Implement unit tests for service layer
  - [x] 2.1 Write unit tests for SongsService
    - Test `findById` cache hit (Firestore not called), cache miss + doc exists (DTO mapped + cache set with TTL 300_000), doc not found (`NotFoundException` with `'Song not found'`)
    - Test `findAll` with valid pagination (`orderBy`, `limit` called, result is `SongResponseDto[]`) and page 2 / pageSize 2 (correct slice returned)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 2.2 Write unit tests for ArtistsService
    - Test `findById` cache hit, doc not found (`NotFoundException` with `'Artist not found'`), cache miss (result stored with TTL 300_000)
    - Test `findSongs` (collection query with `where('artistId', '==', artistId)`, results mapped to `SongResponseDto[]`)
    - Test `findAlbums` (collection query with `where('artistId', '==', artistId)`, results mapped to `AlbumResponseDto[]`)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 2.3 Write unit tests for AlbumsService
    - Test `findById` cache hit, doc not found (`NotFoundException` with `'Album not found'`), cache miss (result cached, DTO has `id`, `title`, `releaseYear`, `coverImageUrl`, `artistId`)
    - Test `findAll` with default pagination (`limit(20)` called)
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 2.4 Write unit tests for PlaylistsService
    - Test `create` (Firestore `add()` called with `ownerUid` and `type: 'user'`)
    - Test `findAllForUser` (query filters on `ownerUid`)
    - Test `addSong` — playlist not found (`NotFoundException`), wrong owner (`ForbiddenException`), song not found (`NotFoundException` with `'Song not found'`)
    - Test `removeSong` wrong owner (`ForbiddenException`)
    - Test `delete` by owner (`doc.delete()` called) and by non-owner (`ForbiddenException`)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [x] 2.5 Write unit tests for SearchService
    - Test `search('')` and `search('   ')` both throw `BadRequestException`
    - Test cache hit (Firestore not called), cache miss (four collection queries executed, results merged and cached)
    - Test result shape (exactly keys `songs`, `artists`, `albums`, `playlists`, each an array)
    - Test playlist filtering (docs with `ownerUid === null` excluded)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 2.6 Write unit tests for SuggestionsService
    - Test query length < 2 throws `BadRequestException`, length == 2 succeeds and Firestore queries run
    - Test cache hit (Firestore not called)
    - Test prefix matches appear before substring-only matches
    - Test result count capped at 10
    - Test playlist filtering (docs with `ownerUid === null` excluded)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 3. Checkpoint — Ensure all service unit tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement unit tests for sync and external service layer
  - [x] 4.1 Write unit tests for GeminiService
    - Mock `@google/generative-ai` via `jest.mock`
    - Test `getPopularGenres` — valid JSON returned, model throws (default list returned, no re-throw)
    - Test `getArtistsForGenre` — duplicate ranks: only first occurrence per rank kept
    - Test `generateSearchQueries` — non-empty string array returned; no API key → default queries containing artist name
    - Test `cleanAndDeduplicate([])` → `[]` without calling model; model unavailable → `basicClean` fallback merges duplicate title+artist entries
    - Test `rankAndDisambiguate` — single result → `videoId` returned without model call; model returns unknown `videoId` → first result's `videoId` returned
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_

  - [x] 4.2 Write unit tests for YouTubeService
    - Mock `axios` via `jest.mock`
    - Test no API key → `[]` returned, no HTTP calls
    - Test search returns items → second HTTP call to videos endpoint for durations
    - Test videos endpoint throws → results still returned, no exception propagated
    - Test search returns empty items → `[]`; search API throws → `[]`, no re-throw
    - Test duration parsing: `'PT1H2M3S'` → 3723, `'PT30S'` → 30, empty/malformed → 0
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [x] 4.3 Write unit tests for SyncService
    - Test `runSync({ genres: [] })` → `getPopularGenres` called once, return used as genre list
    - Test `runSync({ genres: ['Rock'] })` → `getPopularGenres` NOT called
    - Test `force=false` with existing SyncCache doc → `YouTube.search` NOT called for that query
    - Test `force=true` → `YouTube.search` called for every query
    - Test deduplication: existing song (same title + artistName) → no new doc created
    - Test new song: `collection('songs').doc().set()` called with `youtubeId`, `genre`, `artistId`
    - Test error on single song: processing continues for remaining songs
    - Test genre playlists upserted per genre, songs added to correct playlist
    - Test album playlists upserted per album with resolved songs
    - Test duplicate playlist songs not added again
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10_

- [x] 5. Implement unit tests for guards and filters
  - [x] 5.1 Write unit tests for FirebaseAuthGuard
    - Test valid Bearer token → `canActivate` returns `true`, `req.user` has `uid`, `email`, `admin`
    - Test no Authorization header → `UnauthorizedException`
    - Test header not starting with `'Bearer '` → `UnauthorizedException`
    - Test `verifyIdToken` throws → `UnauthorizedException`
    - Test token with `admin: true` → `req.user.admin === true`
    - Test token without `admin` field → `req.user.admin === false`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 5.2 Write unit tests for AdminGuard
    - Test valid token + `req.user.admin === true` → `canActivate` returns `true`
    - Test valid token + `req.user.admin === false` → `ForbiddenException` with `'Admin access required'`
    - Test invalid token (parent throws) → `UnauthorizedException` propagated
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 5.3 Write unit tests for HttpExceptionFilter
    - Build mock `ArgumentsHost` with controllable `response.status().json()` and `request.url`
    - Test `HttpException` (e.g. `NotFoundException`) → response has `statusCode`, `message`, `timestamp` matching exception status
    - Test non-`HttpException` error → `statusCode: 500`, `message: 'Internal server error'`
    - Test `BadRequestException` with message array → `message` field is that array
    - Test `timestamp` is valid ISO 8601 string
    - Test `path` matches `request.url`
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 6. Checkpoint — Ensure all unit tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement integration tests for read endpoints
  - [x] 7.1 Write integration tests for Songs endpoints (`test/songs.e2e-spec.ts`)
    - `GET /songs/:id` — 200 with full DTO (auth set), 404 with `{ statusCode, message, timestamp }` (not found), 401 (no auth)
    - `GET /songs?page=1&pageSize=5` — 200 with array body; `GET /songs` with no params — 200 (defaults applied)
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 7.2 Write integration tests for Artists endpoints (`test/artists.e2e-spec.ts`)
    - `GET /artists/:id` — 200 with `{ id, name, biography, profileImageUrl }`, 404 (not found), 401 (no auth)
    - `GET /artists/:id/songs` — 200 array; `GET /artists/:id/albums` — 200 array
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

  - [x] 7.3 Write integration tests for Albums endpoints (`test/albums.e2e-spec.ts`)
    - `GET /albums/:id` — 200 with `{ id, title, releaseYear, coverImageUrl, artistId }`, 404 (not found), 401 (no auth)
    - `GET /albums` — 200 array
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

- [x] 8. Implement integration tests for write and protected endpoints
  - [x] 8.1 Write integration tests for Playlists endpoints (`test/playlists.e2e-spec.ts`)
    - `POST /playlists` — 201 with `ownerUid` matching authenticated user's UID
    - `GET /playlists` — 200 array of playlists owned by authenticated user
    - `POST /playlists/:id/songs` — 403 (non-owner), 404 (song not found)
    - `DELETE /playlists/:id` — 204 (owner), 403 (non-owner)
    - `DELETE /playlists/:id/songs/:songId` — 204 (owner)
    - Any endpoint without auth → 401
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8_

  - [x] 8.2 Write integration tests for Search endpoint (`test/search.e2e-spec.ts`)
    - `GET /search?q=rock` — 200 with body containing exactly keys `songs`, `artists`, `albums`, `playlists`
    - `GET /search?q=` — 400; `GET /search` (no `q`) — 400; without auth — 401
    - _Requirements: 17.1, 17.2, 17.3, 17.4_

  - [x] 8.3 Write integration tests for Suggestions endpoint (`test/suggestions.e2e-spec.ts`)
    - `GET /suggestions?q=ro` — 200 with array of at most 10 items
    - `GET /suggestions?q=r` — 400
    - `GET /suggestions?q=rock` — 200 with items containing `{ id, name, type }`; without auth — 401
    - _Requirements: 18.1, 18.2, 18.3, 18.4_

  - [x] 8.4 Write integration tests for Sync trigger endpoint (`test/sync.e2e-spec.ts`)
    - `POST /sync/trigger` (admin) — 202 with `{ message: 'Sync triggered' }`
    - `POST /sync/trigger` (non-admin) — 403; (no auth) — 401
    - With `{ genres: ['Rock'], force: true }` → `mockSyncService.runSync` called with those values
    - With empty body → `mockSyncService.runSync` called with default DTO values
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

  - [x] 8.5 Write integration tests for error response shape (`test/error-shape.e2e-spec.ts`)
    - Collect 4xx/5xx responses from multiple endpoints and assert each has `statusCode` (number), `message` (string or string[]), `timestamp` (valid ISO 8601)
    - Trigger 400 from validation → `message` is `string[]`
    - Trigger 500 from unhandled exception (mock throws non-HttpException) → `statusCode: 500`, `message: 'Internal server error'`
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5_

- [x] 9. Checkpoint — Ensure all integration tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement property-based tests
  - [x] 10.1 Write PBT for GeminiService.basicClean — no duplicates and output never grows (`test/gemini.pbt-spec.ts`)
    - **Property 1: basicClean deduplication — no duplicates and output never grows**
    - **Validates: Requirements 21.1, 21.2**

  - [ ]* 10.2 Write PBT for GeminiService.basicClean — no over-deduplication (`test/gemini.pbt-spec.ts`)
    - **Property 2: basicClean no over-deduplication**
    - **Validates: Requirements 21.3**

  - [x] 10.3 Write PBT for SyncService.hashQuery — determinism (`test/sync-hash.pbt-spec.ts`)
    - **Property 3: hashQuery determinism**
    - **Validates: Requirements 22.1**

  - [ ]* 10.4 Write PBT for SyncService.hashQuery — case-insensitivity (`test/sync-hash.pbt-spec.ts`)
    - **Property 4: hashQuery case-insensitivity**
    - **Validates: Requirements 22.2**

  - [ ]* 10.5 Write PBT for SyncService.hashQuery — whitespace trimming (`test/sync-hash.pbt-spec.ts`)
    - **Property 5: hashQuery whitespace trimming**
    - **Validates: Requirements 22.3**

  - [x] 10.6 Write PBT for HttpExceptionFilter — response shape, statusCode round-trip, timestamp validity (`test/http-filter.pbt-spec.ts`)
    - **Property 6: HttpExceptionFilter response shape, statusCode round-trip, and timestamp validity**
    - **Validates: Requirements 23.1, 23.2, 23.3**

  - [ ]* 10.7 Write PBT for SearchService — whitespace-only queries always rejected
    - **Property 7: Whitespace-only search queries are always rejected**
    - **Validates: Requirements 5.2**

  - [ ]* 10.8 Write PBT for SuggestionsService — short queries always rejected
    - **Property 8: Short suggestion queries are always rejected**
    - **Validates: Requirements 6.1**

  - [ ]* 10.9 Write PBT for SuggestionsService — result count upper bound
    - **Property 9: Suggestion result count upper bound**
    - **Validates: Requirements 6.5**

  - [ ]* 10.10 Write PBT for GeminiService.getArtistsForGenre — ranks unique after deduplication
    - **Property 10: GeminiArtistResult ranks are unique after deduplication**
    - **Validates: Requirements 7.3**

- [x] 11. Final checkpoint — Ensure all tests pass
  - Run `jest --runInBand` across all projects (unit, integration, pbt) and ensure all tests pass. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Access private methods in PBT via `(service as any).methodName(input)`
- Each PBT runs a minimum of 100 iterations (`numRuns: 100` in `fc.assert`)
- Use `--runInBand` for integration tests to avoid port conflicts between parallel workers
- Property tests validate universal correctness properties; unit tests validate specific examples and edge cases
