# Implementation Plan: Metadata Backfill Scheduler

## Overview

Implement the `MetadataBackfillScheduler` as a NestJS injectable that runs daily at 4 AM, performing two coordinated backfill phases: song metadata enrichment via Last.fm and mix genres classification via Gemini. The scheduler is gated by a Firestore config flag and auto-disables when no songs need updating.

## Tasks

- [x] 1. Add `genres` field to `SearchMixDto` and update `enrichSearchResults` default mapping
  - Add `genres: string[]` to `SearchMixDto` in `src/songs/dto/search-youtube-response.dto.ts`
  - Update `enrichSearchResults` in `src/songs/songs.service.ts` to default `genres` to `[]` when the field is absent from the Firestore document
  - _Requirements: 5.1, 5.2, 5.3_

  - [ ]* 1.1 Write property test for SearchMixDto genres default
    - **Property 7: SearchMixDto genres default**
    - Generate arbitrary `youtube_searches` document data where mix entries may or may not have a `genres` field; assert every mapped `SearchMixDto` has `genres` as a `string[]`, never `undefined` or `null`
    - **Validates: Requirements 5.2, 5.3**

- [x] 2. Implement `MetadataBackfillScheduler` — scaffold and config phase
  - Create `src/songs/metadata-backfill.scheduler.ts` with the class skeleton: `Logger`, `isRunning` guard, constructor injecting `FirestoreService`, `SongsService`, and `GeminiService`
  - Implement `readBackfillConfig()` — reads `app_config/metadata_backfill`; returns `{ enabled: true }` when document is absent
  - Implement `writeRunSummary()` — writes `lastRun` timestamp and `lastRunSummary` object to the config document
  - Implement `delay()` helper
  - Implement the `@Cron(CronExpression.EVERY_DAY_AT_4AM)` `runBackfill()` outer method with: `isRunning` guard, config flag check, try/finally lock release, and call to `writeRunSummary` at the end of every completed run
  - Log scheduler configuration on initialization (`OnModuleInit`)
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.5, 6.1, 6.2, 6.3_

- [x] 3. Implement `runSongMetadataPhase()` — song metadata backfill
  - Query `songs` collection ordered by `createdAt` ascending in pages of 50; filter documents with Missing_Metadata client-side
  - For each song with missing metadata call `SongsService.refreshMetadata(songId)`, wait 200 ms between calls, catch per-song errors and increment `failed` counter
  - Enforce a hard cap of 500 songs per run; stop paging once the cap is reached
  - When the phase completes with `processed === 0`, call `firestore.doc('app_config/metadata_backfill').update({ enabled: false })` and log auto-cancel
  - Return `SongPhaseResult` (`processed`, `skipped`, `failed`) and log cumulative totals
  - _Requirements: 2.4, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 6.4_

  - [ ]* 3.1 Write property test for song cap enforcement
    - **Property 4: Song cap enforcement**
    - Generate arrays of song IDs with length between 501 and 1000; assert the number of `refreshMetadata` calls is always ≤ 500
    - **Validates: Requirements 3.7**

  - [ ]* 3.2 Write property test for auto-cancel
    - **Property 2: Auto-cancel sets enabled to false**
    - Generate a list of song IDs where all songs have complete metadata (processed = 0); assert the config update call includes `{ enabled: false }`
    - **Validates: Requirements 2.4**

- [x] 4. Implement `runMixGenresPhase()` — mix genres backfill
  - Query `youtube_searches` collection for documents containing at least one Stale_Mix_Entry; limit to 20 documents per run
  - For each document, extract stale mix titles and call `GeminiService.generate(prompt)` with a prompt requesting `{ youtubeId, genres }` JSON array (1–3 genres per mix)
  - Parse the Gemini response and merge `genres` into each corresponding mix entry in Firestore; on parse failure log the error and skip that document
  - Wait 5 seconds between consecutive Gemini calls
  - Return `MixPhaseResult` (`documentsUpdated`, `entriesEnriched`) and log totals
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 6.4_

  - [ ]* 4.1 Write property test for mix document cap enforcement
    - **Property 5: Mix document cap enforcement**
    - Generate arrays of `youtube_searches` document stubs with length between 21 and 50; assert the number of `gemini.generate` calls is always ≤ 20
    - **Validates: Requirements 4.6**

- [x] 5. Register `MetadataBackfillScheduler` in `SongsModule`
  - Add `MetadataBackfillScheduler` to the `providers` array in `src/songs/songs.module.ts`
  - _Requirements: 1.1_

- [x] 6. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Write unit tests for `MetadataBackfillScheduler`
  - [x] 7.1 Create `src/songs/metadata-backfill.scheduler.spec.ts` with mocked `FirestoreService`, `SongsService`, and `GeminiService`
    - _Requirements: 2.3, 2.4, 2.5, 3.4, 3.7, 4.5, 4.6_

  - [ ]* 7.2 Write property test for disabled flag
    - **Property 1: Disabled flag prevents all backfill work**
    - Generate arbitrary `BackfillConfig` objects with `enabled: false`; assert `runBackfill` exits without invoking `refreshMetadata` or `gemini.generate`
    - **Validates: Requirements 2.3**

  - [ ]* 7.3 Write property test for run summary always written
    - **Property 8: Run summary always written**
    - For any completed run (zero or more songs/mixes processed), assert the config document is updated with `lastRun` and `lastRunSummary`
    - **Validates: Requirements 2.5**

- [x] 8. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Property tests use `fast-check` (already present in the project) with a minimum of 100 iterations each
- Each property test references its design property via a comment tag: `// Feature: metadata-backfill-scheduler, Property N: <text>`
- The `isRunning` guard ensures no concurrent runs; the `finally` block always releases it
- `GeminiService` and `SongsService` are already available in `SongsModule` via `SyncModule` import — no new module imports needed
