# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Search Context Ignored in Cache Key and Prompt
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists
  - **Scoped PBT Approach**: Scope the property to concrete failing cases: any non-empty `search` string with a known `songId`
  - In `src/songs/songs.service.spec.ts`, add a `describe('generatePlaylist - bug condition')` block
  - Set up mocks: `mockFirestore._docRef.get` returns `{ exists: false }` for the playlist doc, then a valid seed song doc; `mockYoutube.getRelatedVideos` returns `[]`; `mockGemini.generate` returns `'{"songs":[],"mixes":[],"videos":[],"artists":[]}'`
  - Call `service.generatePlaylist('song1', 30, 'sad reggaeton songs')` and capture the Firestore `doc()` call arguments and the Gemini `generate()` call argument
  - Assert that `mockFirestore.doc` was called with `'playlists_generated/song1_sad_reggaeton_songs'` (search-aware cache key)
  - Assert that the prompt passed to `mockGemini.generate` contains the string `'sad reggaeton songs'`
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found: `mockFirestore.doc` is called with `'playlists_generated/song1'` (no search suffix); prompt does not contain the search string
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - No-Search Path Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for requests where `isBugCondition` is false (no `search`, empty `search`, whitespace-only `search`)
  - Observe: `generatePlaylist('song1', 30)` writes to `playlists_generated/song1` (no suffix)
  - Observe: `generatePlaylist('song1', 30, '')` writes to `playlists_generated/song1` (empty string treated as no-search)
  - Observe: `generatePlaylist('song1', 30, '   ')` writes to `playlists_generated/song1` (whitespace-only treated as no-search)
  - Observe: `generatePlaylist('missing', 30)` throws `NotFoundException`
  - In `src/songs/songs.service.spec.ts`, add a `describe('generatePlaylist - preservation')` block
  - Write property-based test using `fast-check`: generate arbitrary strings from `['', '   ', undefined]` union and verify cache key is always `playlists_generated/{songId}` with no suffix
  - Write test: no-search call writes to `playlists_generated/song1` and prompt does NOT contain any search context prefix
  - Write test: `search = ''` uses same cache key as no-search call
  - Write test: `search = '   '` (whitespace only) uses same cache key as no-search call
  - Write test: missing `songId` still throws `NotFoundException` when `search = 'some query'`
  - Verify all tests PASS on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix: thread search context through controller → service → Gemini prompt and cache key

  - [x] 3.1 Add `search` query param to controller handler
    - In `src/songs/songs.controller.ts`, add `@Query('search') search?: string` to the `generatePlaylist` handler parameters
    - Forward `search` to the service call: `this.songsService.generatePlaylist(id, limit ? parseInt(limit as any) : 30, search)`
    - _Bug_Condition: isBugCondition(X) where X.search IS NOT NULL AND X.search.trim() != ''_
    - _Expected_Behavior: controller extracts search from query string and passes it to service_
    - _Preservation: handler with no search param continues to call service with undefined search_
    - _Requirements: 2.1, 3.1_

  - [x] 3.2 Add `search` parameter and `normalizedSearch` derivation to service method
    - In `src/songs/songs.service.ts`, add optional third parameter `search?: string` to `generatePlaylist(songId, limit, search?)`
    - At the top of the method, compute:
      ```ts
      const normalizedSearch = search?.trim()
        ? search.toLowerCase().trim().replace(/\s+/g, '_')
        : null;
      ```
    - _Bug_Condition: isBugCondition(X) where X.search IS NOT NULL AND X.search.trim() != ''_
    - _Expected_Behavior: normalizedSearch is a lowercase, trimmed, underscore-separated string_
    - _Preservation: normalizedSearch is null when search is absent, empty, or whitespace-only_
    - _Requirements: 2.3, 3.1, 3.2_

  - [x] 3.3 Replace hard-coded cache key with search-aware cache key
    - Derive the cache key immediately after `normalizedSearch`:
      ```ts
      const cacheKey = normalizedSearch
        ? `playlists_generated/${songId}_${normalizedSearch}`
        : `playlists_generated/${songId}`;
      ```
    - Replace every occurrence of the hard-coded path `playlists_generated/${songId}` in the method with `cacheKey` (both the read at the top and the write at the bottom)
    - _Bug_Condition: isBugCondition(X) where X.search IS NOT NULL AND X.search.trim() != ''_
    - _Expected_Behavior: cache key = 'playlists_generated/{songId}_{normalizedSearch}' when search is provided_
    - _Preservation: cache key = 'playlists_generated/{songId}' when search is absent or empty_
    - _Requirements: 2.3, 3.2_

  - [x] 3.4 Inject search context into Gemini prompt
    - Before constructing the `prompt` string, derive:
      ```ts
      const searchContext = normalizedSearch
        ? `The user searched for: "${search.trim()}". Prioritize songs that match this mood, vibe, and intent.\n\n`
        : '';
      ```
    - Prepend `searchContext` to the existing prompt string: `` const prompt = `${searchContext}Classify YouTube results into: songs, mixes, videos, artists.\n...`; ``
    - _Bug_Condition: isBugCondition(X) where X.search IS NOT NULL AND X.search.trim() != ''_
    - _Expected_Behavior: Gemini prompt contains the user's search string as mood/vibe/intent context_
    - _Preservation: Gemini prompt is unchanged (no prefix) when search is absent or empty_
    - _Requirements: 2.1, 2.2, 3.1_

  - [x] 3.5 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Search Context Injected into Prompt and Cache Key
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.6 Verify preservation tests still pass
    - **Property 2: Preservation** - No-Search Path Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint - Ensure all tests pass
  - Run `npx jest src/songs/songs.service.spec.ts --no-coverage` and confirm all tests pass
  - Ensure all tests pass, ask the user if questions arise
