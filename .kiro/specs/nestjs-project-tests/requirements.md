# Requirements Document

## Introduction

A comprehensive test suite for the NestJS Music API. The suite covers all existing modules — Auth, Firestore, Storage, Songs, Artists, Albums, Playlists, Search, Suggestions, Sync, and Common — with unit tests (mocking all external dependencies) and integration tests (using `@nestjs/testing` + `supertest` with mocked external services). Tests cover happy paths, error paths (400, 401, 403, 404, 500), edge cases, the full sync pipeline, auth guard behaviour, and the global error response shape.

This is a test-only spec. No new application code is introduced; all requirements describe test coverage obligations.

## Glossary

- **Test_Suite**: The complete collection of `.spec.ts` files that exercise the NestJS Music API.
- **Unit_Test**: A test that instantiates a single class in isolation, replacing all collaborators with Jest mocks.
- **Integration_Test**: A test that boots a partial NestJS application via `Test.createTestingModule()` and sends HTTP requests via `supertest`, with external services (Firestore, Firebase Admin, Gemini, YouTube) replaced by mock providers.
- **Mock_Firestore**: A Jest mock object that replaces `FirestoreService` in tests, providing controllable `doc()` and `collection()` return values.
- **Mock_Cache**: A Jest mock object that replaces the `CACHE_MANAGER` token, providing controllable `get()` and `set()` return values.
- **Mock_FirebaseAdmin**: A Jest mock object that replaces `FirebaseAdminService`, providing a controllable `auth().verifyIdToken()` method.
- **Mock_Gemini**: A Jest mock object that replaces `GeminiService`, providing controllable return values for all public methods.
- **Mock_YouTube**: A Jest mock object that replaces `YouTubeService`, providing a controllable `search()` method.
- **Happy_Path**: A test scenario where all inputs are valid and all dependencies return expected successful results.
- **Error_Path**: A test scenario that exercises a specific failure mode (e.g. missing token, non-existent resource, forbidden access).
- **Edge_Case**: A test scenario at the boundary of valid input (e.g. minimum-length query, empty array, page size of 1).
- **Cache_Hit**: A scenario where `Mock_Cache.get()` returns a non-null value, causing the service to skip the Firestore call.
- **Cache_Miss**: A scenario where `Mock_Cache.get()` returns `null`, causing the service to call Firestore and then populate the cache.
- **Force_Mode**: A sync run where `force=true`, causing all sync cache entries to be ignored and YouTube to be called unconditionally.
- **SyncCache**: The Firestore `/syncCache/{queryHash}` collection used to store previously executed YouTube search results.
- **FirebaseAuthGuard**: The NestJS guard that verifies Firebase ID tokens and attaches the decoded user to the request.
- **AdminGuard**: The NestJS guard that extends `FirebaseAuthGuard` and additionally requires the `admin: true` custom claim.
- **HttpExceptionFilter**: The global exception filter that normalises all error responses to `{ statusCode, message, timestamp, path }`.

---

## Requirements

### Requirement 1: Unit Tests — SongsService

**User Story:** As a developer, I want unit tests for `SongsService`, so that I can verify song retrieval logic in isolation without hitting Firestore or the cache.

#### Acceptance Criteria

1. WHEN `SongsService.findById` is called and `Mock_Cache.get` returns a cached value, THE Test_Suite SHALL assert that the cached value is returned and that `Mock_Firestore.doc().get()` is NOT called.
2. WHEN `SongsService.findById` is called and `Mock_Cache.get` returns `null` and the Firestore document exists, THE Test_Suite SHALL assert that the document data is mapped to a `SongResponseDto` and stored in the cache via `Mock_Cache.set`.
3. WHEN `SongsService.findById` is called and the Firestore document does not exist (`doc.exists === false`), THE Test_Suite SHALL assert that a `NotFoundException` is thrown with the message `'Song not found'`.
4. WHEN `SongsService.findAll` is called with valid pagination parameters, THE Test_Suite SHALL assert that `Mock_Firestore.collection().orderBy().limit().get()` is called and the result is mapped to an array of `SongResponseDto` objects.
5. WHEN `SongsService.findAll` is called with `page=2` and `pageSize=2`, THE Test_Suite SHALL assert that the correct slice of documents is returned (documents 3 and 4 from a 4-document result set).

---

### Requirement 2: Unit Tests — ArtistsService

**User Story:** As a developer, I want unit tests for `ArtistsService`, so that I can verify artist retrieval and sub-resource listing logic in isolation.

#### Acceptance Criteria

1. WHEN `ArtistsService.findById` is called and `Mock_Cache.get` returns a cached value, THE Test_Suite SHALL assert that the cached value is returned without calling Firestore.
2. WHEN `ArtistsService.findById` is called and the Firestore document does not exist, THE Test_Suite SHALL assert that a `NotFoundException` is thrown with the message `'Artist not found'`.
3. WHEN `ArtistsService.findSongs` is called with a valid artist ID, THE Test_Suite SHALL assert that `Mock_Firestore.collection('songs').where('artistId', '==', artistId).get()` is called and results are mapped to `SongResponseDto` objects.
4. WHEN `ArtistsService.findAlbums` is called with a valid artist ID, THE Test_Suite SHALL assert that `Mock_Firestore.collection('albums').where('artistId', '==', artistId).get()` is called and results are mapped to `AlbumResponseDto` objects.
5. WHEN `ArtistsService.findById` is called on a cache miss, THE Test_Suite SHALL assert that the result is stored in the cache with a TTL of 300,000 ms.

---

### Requirement 3: Unit Tests — AlbumsService

**User Story:** As a developer, I want unit tests for `AlbumsService`, so that I can verify album retrieval logic in isolation.

#### Acceptance Criteria

1. WHEN `AlbumsService.findById` is called and `Mock_Cache.get` returns a cached value, THE Test_Suite SHALL assert that the cached value is returned without calling Firestore.
2. WHEN `AlbumsService.findById` is called and the Firestore document does not exist, THE Test_Suite SHALL assert that a `NotFoundException` is thrown with the message `'Album not found'`.
3. WHEN `AlbumsService.findAll` is called with default pagination (`page=1`, `pageSize=20`), THE Test_Suite SHALL assert that `limit(20)` is passed to the Firestore query.
4. WHEN `AlbumsService.findById` is called on a cache miss, THE Test_Suite SHALL assert that the result is stored in the cache and the returned DTO contains `id`, `title`, `releaseYear`, `coverImageUrl`, and `artistId`.

---

### Requirement 4: Unit Tests — PlaylistsService

**User Story:** As a developer, I want unit tests for `PlaylistsService`, so that I can verify playlist CRUD and ownership enforcement logic in isolation.

#### Acceptance Criteria

1. WHEN `PlaylistsService.create` is called with a valid `ownerUid` and `CreatePlaylistDto`, THE Test_Suite SHALL assert that a new Firestore document is created with `ownerUid` set to the caller's UID and `type` set to `'user'`.
2. WHEN `PlaylistsService.findAllForUser` is called, THE Test_Suite SHALL assert that the Firestore query filters on `ownerUid == ownerUid`.
3. WHEN `PlaylistsService.addSong` is called and the playlist does not exist, THE Test_Suite SHALL assert that a `NotFoundException` is thrown.
4. WHEN `PlaylistsService.addSong` is called and the playlist is owned by a different user, THE Test_Suite SHALL assert that a `ForbiddenException` is thrown.
5. WHEN `PlaylistsService.addSong` is called and the song document does not exist, THE Test_Suite SHALL assert that a `NotFoundException` is thrown with the message `'Song not found'`.
6. WHEN `PlaylistsService.removeSong` is called and the playlist is owned by a different user, THE Test_Suite SHALL assert that a `ForbiddenException` is thrown.
7. WHEN `PlaylistsService.delete` is called by the playlist owner, THE Test_Suite SHALL assert that `Mock_Firestore.doc('playlists/{id}').delete()` is called.
8. WHEN `PlaylistsService.delete` is called by a non-owner, THE Test_Suite SHALL assert that a `ForbiddenException` is thrown.

---

### Requirement 5: Unit Tests — SearchService

**User Story:** As a developer, I want unit tests for `SearchService`, so that I can verify search query validation, cache behaviour, and result merging logic in isolation.

#### Acceptance Criteria

1. WHEN `SearchService.search` is called with an empty string, THE Test_Suite SHALL assert that a `BadRequestException` is thrown.
2. WHEN `SearchService.search` is called with a whitespace-only string, THE Test_Suite SHALL assert that a `BadRequestException` is thrown.
3. WHEN `SearchService.search` is called and `Mock_Cache.get` returns a cached result, THE Test_Suite SHALL assert that the cached result is returned without calling Firestore.
4. WHEN `SearchService.search` is called on a cache miss, THE Test_Suite SHALL assert that four Firestore collection queries are executed (songs, artists, albums, playlists) and results are merged and cached.
5. WHEN `SearchService.search` returns results, THE Test_Suite SHALL assert that the result object contains exactly the keys `songs`, `artists`, `albums`, and `playlists`, each being an array.
6. WHEN `SearchService.search` processes playlists, THE Test_Suite SHALL assert that documents with `ownerUid === null` are excluded from the results.

---

### Requirement 6: Unit Tests — SuggestionsService

**User Story:** As a developer, I want unit tests for `SuggestionsService`, so that I can verify suggestion query validation, prefix/substring ranking, and cache behaviour in isolation.

#### Acceptance Criteria

1. WHEN `SuggestionsService.suggest` is called with a query shorter than 2 characters, THE Test_Suite SHALL assert that a `BadRequestException` is thrown.
2. WHEN `SuggestionsService.suggest` is called with a query of exactly 2 characters, THE Test_Suite SHALL assert that no exception is thrown and Firestore queries are executed.
3. WHEN `SuggestionsService.suggest` is called and `Mock_Cache.get` returns a cached result, THE Test_Suite SHALL assert that the cached result is returned without calling Firestore.
4. WHEN `SuggestionsService.suggest` returns results containing both prefix matches and substring-only matches, THE Test_Suite SHALL assert that all prefix matches appear before all substring-only matches in the returned array.
5. WHEN `SuggestionsService.suggest` returns results, THE Test_Suite SHALL assert that the array contains at most 10 items regardless of how many Firestore documents match.
6. WHEN `SuggestionsService.suggest` processes playlists, THE Test_Suite SHALL assert that documents with `ownerUid === null` are excluded from the results.

---

### Requirement 7: Unit Tests — GeminiService

**User Story:** As a developer, I want unit tests for `GeminiService`, so that I can verify prompt handling, JSON extraction, fallback behaviour, and deduplication logic in isolation.

#### Acceptance Criteria

1. WHEN `GeminiService.getPopularGenres` is called and the Gemini model returns a valid JSON array, THE Test_Suite SHALL assert that the parsed array is returned.
2. WHEN `GeminiService.getPopularGenres` is called and the Gemini model throws an error, THE Test_Suite SHALL assert that the default genre list is returned without re-throwing.
3. WHEN `GeminiService.getArtistsForGenre` is called and the model returns artists with duplicate ranks, THE Test_Suite SHALL assert that only the first occurrence of each rank is kept in the returned list.
4. WHEN `GeminiService.generateSearchQueries` is called with an artist name and `topSongs`, THE Test_Suite SHALL assert that the returned array is non-empty and each element is a non-empty string.
5. WHEN `GeminiService.generateSearchQueries` is called and the model is unavailable (`GEMINI_API_KEY` not set), THE Test_Suite SHALL assert that default queries are returned containing the artist name.
6. WHEN `GeminiService.cleanAndDeduplicate` is called with an empty array, THE Test_Suite SHALL assert that an empty array is returned without calling the model.
7. WHEN `GeminiService.cleanAndDeduplicate` is called and the model is unavailable, THE Test_Suite SHALL assert that `basicClean` fallback logic is used: duplicate entries with the same normalized title and artist are merged into a single entry.
8. WHEN `GeminiService.rankAndDisambiguate` is called with a single result, THE Test_Suite SHALL assert that the `videoId` of that result is returned without calling the model.
9. WHEN `GeminiService.rankAndDisambiguate` is called and the model returns a `videoId` not present in the input list, THE Test_Suite SHALL assert that the first result's `videoId` is returned as a fallback.

---

### Requirement 8: Unit Tests — YouTubeService

**User Story:** As a developer, I want unit tests for `YouTubeService`, so that I can verify HTTP call construction, duration parsing, and error handling in isolation.

#### Acceptance Criteria

1. WHEN `YouTubeService.search` is called and `YOUTUBE_API_KEY` is not set, THE Test_Suite SHALL assert that an empty array is returned without making any HTTP calls.
2. WHEN `YouTubeService.search` is called and the YouTube search API returns items, THE Test_Suite SHALL assert that a second HTTP call is made to the videos endpoint to fetch durations.
3. WHEN `YouTubeService.search` is called and the videos duration endpoint throws an error, THE Test_Suite SHALL assert that results are still returned (duration fetch is best-effort) and no exception is propagated.
4. WHEN `YouTubeService.search` is called and the search API returns an empty `items` array, THE Test_Suite SHALL assert that an empty array is returned.
5. WHEN `YouTubeService.search` is called and the search API throws an error, THE Test_Suite SHALL assert that an empty array is returned without re-throwing.
6. THE Test_Suite SHALL assert that the ISO 8601 duration string `'PT1H2M3S'` is parsed to `3723` seconds.
7. THE Test_Suite SHALL assert that the ISO 8601 duration string `'PT30S'` is parsed to `30` seconds.
8. THE Test_Suite SHALL assert that an empty or malformed duration string is parsed to `0` seconds.

---

### Requirement 9: Unit Tests — SyncService

**User Story:** As a developer, I want unit tests for `SyncService`, so that I can verify the full sync pipeline orchestration logic in isolation with all external dependencies mocked.

#### Acceptance Criteria

1. WHEN `SyncService.runSync` is called with an empty `genres` array, THE Test_Suite SHALL assert that `Mock_Gemini.getPopularGenres()` is called exactly once and its return value is used as the genre list.
2. WHEN `SyncService.runSync` is called with a non-empty `genres` array, THE Test_Suite SHALL assert that `Mock_Gemini.getPopularGenres()` is NOT called.
3. WHEN `SyncService.runSync` is called with `force=false` and a SyncCache document exists for a query hash, THE Test_Suite SHALL assert that `Mock_YouTube.search()` is NOT called for that query and the cached results are used.
4. WHEN `SyncService.runSync` is called with `force=true`, THE Test_Suite SHALL assert that `Mock_YouTube.search()` is called for every query regardless of whether a SyncCache document exists.
5. WHEN `SyncService.runSync` processes a song that already exists in Firestore (same title + artistName), THE Test_Suite SHALL assert that no new song document is created (deduplication).
6. WHEN `SyncService.runSync` processes a new song, THE Test_Suite SHALL assert that `Mock_Firestore.collection('songs').doc().set()` is called with the correct fields including `youtubeId`, `genre`, and `artistId`.
7. WHEN `SyncService.runSync` encounters an error persisting a single song, THE Test_Suite SHALL assert that processing continues for remaining songs and the error is logged.
8. WHEN `SyncService.runSync` completes, THE Test_Suite SHALL assert that genre playlists are upserted for each input genre and each resolved song is added to the correct genre playlist.
9. WHEN `SyncService.runSync` completes, THE Test_Suite SHALL assert that album playlists are upserted for each album that had songs resolved in the run.
10. WHEN `SyncService.runSync` adds songs to an existing playlist, THE Test_Suite SHALL assert that songs already present in the playlist subcollection are NOT added again.

---

### Requirement 10: Unit Tests — FirebaseAuthGuard

**User Story:** As a developer, I want unit tests for `FirebaseAuthGuard`, so that I can verify token extraction, verification, and request decoration logic in isolation.

#### Acceptance Criteria

1. WHEN `FirebaseAuthGuard.canActivate` is called with a request containing a valid `Authorization: Bearer <token>` header and `Mock_FirebaseAdmin.auth().verifyIdToken()` resolves successfully, THE Test_Suite SHALL assert that `canActivate` returns `true` and `req.user` is populated with `uid`, `email`, and `admin` fields.
2. WHEN `FirebaseAuthGuard.canActivate` is called with a request that has no `Authorization` header, THE Test_Suite SHALL assert that an `UnauthorizedException` is thrown.
3. WHEN `FirebaseAuthGuard.canActivate` is called with a request that has an `Authorization` header not starting with `'Bearer '`, THE Test_Suite SHALL assert that an `UnauthorizedException` is thrown.
4. WHEN `FirebaseAuthGuard.canActivate` is called and `Mock_FirebaseAdmin.auth().verifyIdToken()` throws an error, THE Test_Suite SHALL assert that an `UnauthorizedException` is thrown.
5. WHEN `FirebaseAuthGuard.canActivate` is called with a token whose decoded payload contains `admin: true`, THE Test_Suite SHALL assert that `req.user.admin` is set to `true`.
6. WHEN `FirebaseAuthGuard.canActivate` is called with a token whose decoded payload does not contain an `admin` field, THE Test_Suite SHALL assert that `req.user.admin` is set to `false`.

---

### Requirement 11: Unit Tests — AdminGuard

**User Story:** As a developer, I want unit tests for `AdminGuard`, so that I can verify that admin claim enforcement is applied on top of standard token verification.

#### Acceptance Criteria

1. WHEN `AdminGuard.canActivate` is called with a valid token and `req.user.admin === true`, THE Test_Suite SHALL assert that `canActivate` returns `true`.
2. WHEN `AdminGuard.canActivate` is called with a valid token and `req.user.admin === false`, THE Test_Suite SHALL assert that a `ForbiddenException` is thrown with the message `'Admin access required'`.
3. WHEN `AdminGuard.canActivate` is called with an invalid token (parent guard throws), THE Test_Suite SHALL assert that an `UnauthorizedException` is propagated before the admin claim check is reached.

---

### Requirement 12: Unit Tests — HttpExceptionFilter

**User Story:** As a developer, I want unit tests for `HttpExceptionFilter`, so that I can verify that all error responses conform to the standard shape.

#### Acceptance Criteria

1. WHEN `HttpExceptionFilter.catch` is called with an `HttpException` (e.g. `NotFoundException`), THE Test_Suite SHALL assert that the response JSON contains `statusCode`, `message`, and `timestamp` fields and that `statusCode` matches the exception's HTTP status code.
2. WHEN `HttpExceptionFilter.catch` is called with a non-`HttpException` error, THE Test_Suite SHALL assert that the response JSON contains `statusCode: 500` and `message: 'Internal server error'`.
3. WHEN `HttpExceptionFilter.catch` is called with a validation `BadRequestException` whose response body contains a `message` array, THE Test_Suite SHALL assert that the `message` field in the response JSON is that array.
4. THE Test_Suite SHALL assert that the `timestamp` field in every error response is a valid ISO 8601 date string.
5. THE Test_Suite SHALL assert that the `path` field in every error response matches the request URL.

---

### Requirement 13: Integration Tests — Songs Endpoints

**User Story:** As a developer, I want integration tests for the Songs endpoints, so that I can verify the full HTTP request/response cycle including auth guard enforcement.

#### Acceptance Criteria

1. WHEN `GET /songs/:id` is called with a valid auth token and the song exists, THE Test_Suite SHALL assert that the response status is 200 and the body contains `id`, `title`, `artistId`, `durationSeconds`, `coverImageUrl`, `youtubeId`, and `genre`.
2. WHEN `GET /songs/:id` is called with a valid auth token and the song does not exist, THE Test_Suite SHALL assert that the response status is 404 and the body contains `statusCode`, `message`, and `timestamp`.
3. WHEN `GET /songs/:id` is called without an auth token, THE Test_Suite SHALL assert that the response status is 401.
4. WHEN `GET /songs` is called with valid pagination query parameters, THE Test_Suite SHALL assert that the response status is 200 and the body is an array.
5. WHEN `GET /songs` is called without pagination parameters, THE Test_Suite SHALL assert that the response status is 200 (defaults applied).

---

### Requirement 14: Integration Tests — Artists Endpoints

**User Story:** As a developer, I want integration tests for the Artists endpoints, so that I can verify artist retrieval and sub-resource listing over HTTP.

#### Acceptance Criteria

1. WHEN `GET /artists/:id` is called with a valid auth token and the artist exists, THE Test_Suite SHALL assert that the response status is 200 and the body contains `id`, `name`, `biography`, and `profileImageUrl`.
2. WHEN `GET /artists/:id` is called with a valid auth token and the artist does not exist, THE Test_Suite SHALL assert that the response status is 404.
3. WHEN `GET /artists/:id/songs` is called with a valid auth token, THE Test_Suite SHALL assert that the response status is 200 and the body is an array.
4. WHEN `GET /artists/:id/albums` is called with a valid auth token, THE Test_Suite SHALL assert that the response status is 200 and the body is an array.
5. WHEN `GET /artists/:id` is called without an auth token, THE Test_Suite SHALL assert that the response status is 401.

---

### Requirement 15: Integration Tests — Albums Endpoints

**User Story:** As a developer, I want integration tests for the Albums endpoints, so that I can verify album retrieval over HTTP.

#### Acceptance Criteria

1. WHEN `GET /albums/:id` is called with a valid auth token and the album exists, THE Test_Suite SHALL assert that the response status is 200 and the body contains `id`, `title`, `releaseYear`, `coverImageUrl`, and `artistId`.
2. WHEN `GET /albums/:id` is called with a valid auth token and the album does not exist, THE Test_Suite SHALL assert that the response status is 404.
3. WHEN `GET /albums` is called with a valid auth token, THE Test_Suite SHALL assert that the response status is 200 and the body is an array.
4. WHEN `GET /albums/:id` is called without an auth token, THE Test_Suite SHALL assert that the response status is 401.

---

### Requirement 16: Integration Tests — Playlists Endpoints

**User Story:** As a developer, I want integration tests for the Playlists endpoints, so that I can verify playlist CRUD, ownership enforcement, and 403/404 error paths over HTTP.

#### Acceptance Criteria

1. WHEN `POST /playlists` is called with a valid auth token and a valid request body, THE Test_Suite SHALL assert that the response status is 201 and the body contains the created playlist with `ownerUid` matching the authenticated user's UID.
2. WHEN `GET /playlists` is called with a valid auth token, THE Test_Suite SHALL assert that the response status is 200 and the body is an array containing only playlists owned by the authenticated user.
3. WHEN `POST /playlists/:id/songs` is called by a user who does not own the playlist, THE Test_Suite SHALL assert that the response status is 403.
4. WHEN `POST /playlists/:id/songs` is called with a `songId` that does not exist, THE Test_Suite SHALL assert that the response status is 404.
5. WHEN `DELETE /playlists/:id` is called by the playlist owner, THE Test_Suite SHALL assert that the response status is 204.
6. WHEN `DELETE /playlists/:id` is called by a non-owner, THE Test_Suite SHALL assert that the response status is 403.
7. WHEN `DELETE /playlists/:id/songs/:songId` is called by the playlist owner, THE Test_Suite SHALL assert that the response status is 204.
8. WHEN any Playlists endpoint is called without an auth token, THE Test_Suite SHALL assert that the response status is 401.

---

### Requirement 17: Integration Tests — Search Endpoint

**User Story:** As a developer, I want integration tests for the Search endpoint, so that I can verify query validation, result shape, and auth enforcement over HTTP.

#### Acceptance Criteria

1. WHEN `GET /search?q=rock` is called with a valid auth token, THE Test_Suite SHALL assert that the response status is 200 and the body contains exactly the keys `songs`, `artists`, `albums`, and `playlists`.
2. WHEN `GET /search?q=` is called with a valid auth token (empty query), THE Test_Suite SHALL assert that the response status is 400.
3. WHEN `GET /search` is called without the `q` parameter, THE Test_Suite SHALL assert that the response status is 400.
4. WHEN `GET /search?q=rock` is called without an auth token, THE Test_Suite SHALL assert that the response status is 401.

---

### Requirement 18: Integration Tests — Suggestions Endpoint

**User Story:** As a developer, I want integration tests for the Suggestions endpoint, so that I can verify minimum-length enforcement and result shape over HTTP.

#### Acceptance Criteria

1. WHEN `GET /suggestions?q=ro` is called with a valid auth token (2-character query), THE Test_Suite SHALL assert that the response status is 200 and the body is an array of at most 10 items.
2. WHEN `GET /suggestions?q=r` is called with a valid auth token (1-character query), THE Test_Suite SHALL assert that the response status is 400.
3. WHEN `GET /suggestions?q=rock` is called with a valid auth token, THE Test_Suite SHALL assert that each item in the response array contains `id`, `name`, and `type` fields.
4. WHEN `GET /suggestions?q=rock` is called without an auth token, THE Test_Suite SHALL assert that the response status is 401.

---

### Requirement 19: Integration Tests — Sync Trigger Endpoint

**User Story:** As a developer, I want integration tests for `POST /sync/trigger`, so that I can verify admin-only access, request body handling, and async fire-and-forget behaviour over HTTP.

#### Acceptance Criteria

1. WHEN `POST /sync/trigger` is called with a valid admin token, THE Test_Suite SHALL assert that the response status is 202 and the body contains `{ message: 'Sync triggered' }`.
2. WHEN `POST /sync/trigger` is called with a valid non-admin token, THE Test_Suite SHALL assert that the response status is 403.
3. WHEN `POST /sync/trigger` is called without an auth token, THE Test_Suite SHALL assert that the response status is 401.
4. WHEN `POST /sync/trigger` is called with `{ "genres": ["Rock"], "force": true }`, THE Test_Suite SHALL assert that `Mock_SyncService.runSync` is called with `{ genres: ['Rock'], force: true }`.
5. WHEN `POST /sync/trigger` is called with an empty body, THE Test_Suite SHALL assert that `Mock_SyncService.runSync` is called with the default DTO values.

---

### Requirement 20: Error Response Shape — Cross-Cutting

**User Story:** As a developer, I want tests that verify the global error response shape across all modules, so that I can guarantee clients always receive a consistent error structure.

#### Acceptance Criteria

1. THE Test_Suite SHALL assert that every 4xx and 5xx response from any endpoint contains a JSON body with a `statusCode` field of type `number`.
2. THE Test_Suite SHALL assert that every 4xx and 5xx response from any endpoint contains a JSON body with a `message` field of type `string` or `string[]`.
3. THE Test_Suite SHALL assert that every 4xx and 5xx response from any endpoint contains a JSON body with a `timestamp` field that is a valid ISO 8601 date string.
4. WHEN a validation error occurs (HTTP 400 from class-validator), THE Test_Suite SHALL assert that the `message` field is an array of validation error strings.
5. WHEN an unhandled exception occurs, THE Test_Suite SHALL assert that the response status is 500 and `message` is `'Internal server error'`.

---

### Requirement 21: Property-Based Tests — GeminiService.cleanAndDeduplicate (basicClean fallback)

**User Story:** As a developer, I want property-based tests for the `basicClean` fallback in `GeminiService`, so that I can verify deduplication and normalization invariants hold across arbitrary inputs.

#### Acceptance Criteria

1. FOR ALL non-empty arrays of `RawYouTubeResult` objects, THE Test_Suite SHALL assert that the output of `basicClean` contains no two entries with the same normalized `title.toLowerCase() + '|' + artistName.toLowerCase()` key (no duplicates).
2. FOR ALL non-empty arrays of `RawYouTubeResult` objects, THE Test_Suite SHALL assert that the length of the `basicClean` output is less than or equal to the length of the input (deduplication never increases count).
3. FOR ALL `RawYouTubeResult` arrays where all entries have distinct normalized title+artist keys, THE Test_Suite SHALL assert that the `basicClean` output length equals the input length (no over-deduplication).

---

### Requirement 22: Property-Based Tests — SyncService.hashQuery

**User Story:** As a developer, I want property-based tests for `SyncService.hashQuery`, so that I can verify that the hash function is deterministic and case/whitespace-insensitive.

#### Acceptance Criteria

1. FOR ALL non-empty query strings `q`, THE Test_Suite SHALL assert that `hashQuery(q) === hashQuery(q)` (determinism).
2. FOR ALL non-empty query strings `q`, THE Test_Suite SHALL assert that `hashQuery(q.trim().toLowerCase()) === hashQuery(q.trim().toUpperCase())` — the hash is case-insensitive because the implementation normalizes to lowercase before hashing.
3. FOR ALL non-empty query strings `q`, THE Test_Suite SHALL assert that `hashQuery('  ' + q + '  ') === hashQuery(q.trim())` — leading/trailing whitespace is stripped before hashing.

---

### Requirement 23: Property-Based Tests — HttpExceptionFilter response shape

**User Story:** As a developer, I want property-based tests for `HttpExceptionFilter`, so that I can verify the error response shape invariant holds for arbitrary HTTP status codes and messages.

#### Acceptance Criteria

1. FOR ALL valid HTTP status codes (400–599) and arbitrary message strings, THE Test_Suite SHALL assert that `HttpExceptionFilter` produces a response JSON containing `statusCode`, `message`, and `timestamp` fields.
2. FOR ALL valid HTTP status codes (400–599), THE Test_Suite SHALL assert that the `statusCode` field in the response JSON equals the HTTP status code of the exception.
3. FOR ALL arbitrary message strings passed to an `HttpException`, THE Test_Suite SHALL assert that the `timestamp` field is always a valid ISO 8601 date string (parseable by `new Date()`).
