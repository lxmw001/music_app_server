# Requirements Document

## Introduction

This feature adds a daily background scheduler to the NestJS Music API that performs three coordinated backfill tasks:

1. **Song metadata backfill** — queries Firestore for songs missing key metadata fields (`genres`, `tags`, `album`, `coverImageUrl`, `listeners`, `mbid`) and enriches them via the existing `refreshMetadata` logic (Last.fm API), processing in batches of 50 with rate limiting.

2. **Auto-cancel via Firestore flag** — a Firestore document (`app_config/metadata_backfill`) with an `enabled: boolean` field gates all job runs. When a run completes with zero songs needing update, the Scheduler sets `enabled: false` automatically. Future runs are skipped until the flag is manually re-enabled.

3. **Mix genres backfill** — existing `youtube_searches` Firestore documents contain a `mixes` array whose entries lack a `genres` field. The Scheduler processes these stale mix entries in batches, calls Gemini to classify genres for each mix title, and writes the result back to Firestore. The `SearchMixDto` gains a `genres: string[]` field. This work runs entirely in the background and does not affect the search endpoint response path.

## Glossary

- **Scheduler**: The `MetadataBackfillScheduler` NestJS injectable that owns the daily cron job.
- **Song_Document**: A Firestore document in the `songs` collection representing a single music track.
- **Mix_Entry**: An element of the `mixes` array inside a `youtube_searches` Firestore document.
- **Backfill_Config**: The Firestore document at path `app_config/metadata_backfill` that controls job execution.
- **SongsService**: The existing NestJS service at `src/songs/songs.service.ts` that exposes `refreshMetadata(songId)`.
- **GeminiService**: The existing NestJS service at `src/sync/gemini.service.ts` that exposes `generate(prompt)`.
- **LastFmService**: The existing NestJS service at `src/sync/lastfm.service.ts` that exposes `searchTrack(title, artist)`.
- **SearchMixDto**: The DTO class in `src/songs/dto/search-youtube-response.dto.ts` representing a mix result.
- **Missing_Metadata**: A Song_Document is considered to have missing metadata when at least one of the following fields is absent or empty: `genres`, `tags`, `album`, `coverImageUrl`, `listeners`, `mbid`.
- **Stale_Mix_Entry**: A Mix_Entry that does not have a `genres` field or has an empty `genres` array.

---

## Requirements

### Requirement 1: Daily Scheduled Execution

**User Story:** As an operator, I want a daily background job that backfills missing song metadata and mix genres, so that the music catalog stays enriched without manual intervention.

#### Acceptance Criteria

1. THE Scheduler SHALL execute once per day at 4:00 AM using `@Cron(CronExpression.EVERY_DAY_AT_4AM)`.
2. WHILE a previous run of the Scheduler is still executing, THE Scheduler SHALL skip the new invocation and log a warning.
3. WHEN the Scheduler run starts, THE Scheduler SHALL log the start time and the phase being entered.
4. WHEN the Scheduler run completes, THE Scheduler SHALL log the total duration and a summary of results for each phase.

---

### Requirement 2: Backfill Config Flag Check

**User Story:** As an operator, I want the job to respect a Firestore-managed on/off flag, so that I can disable the job once the catalog is fully enriched and re-enable it if new songs are added.

#### Acceptance Criteria

1. WHEN the Scheduler run starts, THE Scheduler SHALL read the `enabled` field from the Backfill_Config document before performing any backfill work.
2. IF the Backfill_Config document does not exist, THEN THE Scheduler SHALL treat `enabled` as `true` and proceed with the run.
3. IF the `enabled` field is `false`, THEN THE Scheduler SHALL skip all backfill phases and log that the job is disabled.
4. WHEN a song metadata backfill phase completes with zero songs processed (nothing needed updating), THE Scheduler SHALL set `enabled: false` on the Backfill_Config document and log that auto-cancel was triggered.
5. THE Backfill_Config document SHALL be updated with a `lastRun` timestamp and a `lastRunSummary` object at the end of every completed run.

---

### Requirement 3: Song Metadata Backfill Phase

**User Story:** As an operator, I want the job to find songs missing metadata and enrich them via Last.fm, so that the catalog has complete genre, tag, album, and listener data.

#### Acceptance Criteria

1. WHEN the song metadata backfill phase runs, THE Scheduler SHALL query the `songs` Firestore collection for Song_Documents that have Missing_Metadata, processing in pages of 50 documents ordered by `createdAt` ascending.
2. FOR EACH Song_Document with Missing_Metadata, THE Scheduler SHALL call `SongsService.refreshMetadata(songId)` to enrich the document via Last.fm.
3. WHEN processing a batch of songs, THE Scheduler SHALL wait at least 200 milliseconds between consecutive `refreshMetadata` calls to respect Last.fm API rate limits.
4. IF `SongsService.refreshMetadata` throws an error for a specific song, THEN THE Scheduler SHALL log the error with the song ID and continue processing the remaining songs in the batch.
5. WHEN a batch completes, THE Scheduler SHALL log the number of songs processed, skipped, and failed in that batch.
6. WHEN all pages have been processed and the total number of songs that needed updating is zero, THE Scheduler SHALL report zero songs processed to trigger the auto-cancel logic in Requirement 2.4.
7. THE Scheduler SHALL process at most 500 songs per run to prevent excessive API usage in a single execution.

---

### Requirement 4: Mix Genres Backfill Phase

**User Story:** As an operator, I want the job to classify genres for existing mix entries that lack them, so that mix results can be filtered and displayed with genre information.

#### Acceptance Criteria

1. WHEN the mix genres backfill phase runs, THE Scheduler SHALL query the `youtube_searches` Firestore collection for documents that contain at least one Stale_Mix_Entry.
2. FOR EACH document containing Stale_Mix_Entry items, THE Scheduler SHALL extract the Stale_Mix_Entry titles and call `GeminiService.generate(prompt)` with a prompt requesting genre classification for those titles.
3. THE prompt sent to GeminiService SHALL request a JSON array where each element contains `{ youtubeId: string, genres: string[] }` with 1–3 genre strings per mix.
4. WHEN GeminiService returns a valid response, THE Scheduler SHALL update each Stale_Mix_Entry in the Firestore document by merging the returned `genres` array into the corresponding mix entry.
5. IF GeminiService returns an invalid or unparseable response for a batch, THEN THE Scheduler SHALL log the error and skip updating that batch without failing the entire phase.
6. WHEN processing mix batches, THE Scheduler SHALL process at most 20 `youtube_searches` documents per run to limit Gemini API usage.
7. WHEN processing mix batches, THE Scheduler SHALL wait at least 5 seconds between consecutive Gemini API calls to respect the existing rate limiting in GeminiService.
8. WHEN the mix genres backfill phase completes, THE Scheduler SHALL log the number of documents updated and the total number of mix entries enriched.

---

### Requirement 5: SearchMixDto genres field

**User Story:** As a client developer, I want mix results to include a `genres` field, so that the UI can display or filter mixes by genre.

#### Acceptance Criteria

1. THE SearchMixDto SHALL include a `genres` field of type `string[]`.
2. WHEN a `youtube_searches` document is read and its mix entries do not contain a `genres` field, THE SongsService SHALL return an empty array `[]` for that mix entry's `genres` field in the API response.
3. WHEN a `youtube_searches` document is read and its mix entries contain a populated `genres` field, THE SongsService SHALL include those genre strings in the API response for that mix entry.
4. THE addition of the `genres` field to SearchMixDto SHALL NOT change the response time of the search endpoint (genres are populated by the background Scheduler, not inline during search).

---

### Requirement 6: Observability and Error Resilience

**User Story:** As an operator, I want the scheduler to log structured progress and handle errors gracefully, so that I can monitor backfill progress and the job never crashes the application.

#### Acceptance Criteria

1. THE Scheduler SHALL use NestJS `Logger` with the class name as context for all log output.
2. IF any unhandled error occurs during a run, THEN THE Scheduler SHALL catch it, log the error message and stack trace, and release the running lock so future runs are not blocked.
3. WHEN the Scheduler is initialized, THE Scheduler SHALL log its configuration (cron schedule, batch size, max songs per run, max documents per run).
4. THE Scheduler SHALL track and log cumulative totals across all batches: total songs processed, total songs skipped, total songs failed, total mix documents updated, total mix entries enriched.
