# Playlist Generation Search Context Bugfix Design

## Overview

The `generatePlaylist` method in `songs.service.ts` ignores the optional `search` query parameter
that users pass from their original search context. As a result, two users who tap the same seed
song from completely different intents (e.g. "sad reggaeton" vs "party hits") receive identical
playlists. The fix threads an optional `search` string through the controller → service → Gemini
prompt, and uses a search-aware cache key so each distinct intent gets its own cached playlist.
No new files are needed; changes are confined to `songs.controller.ts` and `songs.service.ts`.

---

## Glossary

- **Bug_Condition (C)**: A request where `search` is present and non-empty — the condition that
  currently causes the search context to be silently ignored.
- **Property (P)**: When the bug condition holds, the Gemini prompt SHALL include the search string
  as mood/vibe/intent context, and the cache key SHALL be `playlists_generated/{songId}_{normalizedSearch}`.
- **Preservation**: All behavior for requests without a `search` parameter must remain byte-for-byte
  identical to the current implementation.
- **normalizedSearch**: `search.toLowerCase().trim().replace(/\s+/g, '_')` — a deterministic,
  filesystem-safe representation of the search string used in cache keys.
- **generatePlaylist(songId, limit, search?)**: The method in `src/songs/songs.service.ts` that
  fetches related YouTube videos, classifies them with Gemini, and caches the result.
- **isBugCondition**: Pseudocode predicate that returns `true` when a request carries a non-empty
  `search` value — i.e. the inputs that currently trigger the defect.

---

## Bug Details

### Bug Condition

The bug manifests when `GET /songs/:id/generate-playlist` is called with a non-empty `search`
query parameter. The controller does not forward `search` to the service, and the service has no
parameter to receive it, so the value is discarded before any logic runs.

**Formal Specification:**

```
FUNCTION isBugCondition(X)
  INPUT: X of type PlaylistRequest { songId: string, limit: number, search?: string }
  OUTPUT: boolean

  RETURN X.search IS NOT NULL
         AND X.search.trim() != ''
END FUNCTION
```

### Examples

- User searches "sad reggaeton songs", taps a seed song → `search = "sad reggaeton songs"` is
  ignored; playlist is identical to a search-free request for the same seed.
- User searches "party hits 2024", taps the same seed song → receives the exact same playlist as
  the "sad reggaeton" user, despite completely different intent.
- User calls the endpoint without `search` → no change; existing behavior is preserved (this is
  the non-buggy path).
- User calls with `search = "  "` (whitespace only) → treated as no search context after trim;
  falls through to the unchanged path.

---

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Requests without `search` MUST continue to use cache key `playlists_generated/{songId}` with
  a 7-day TTL and return the cached result when fresh.
- The `limit` parameter MUST continue to cap the returned playlist size regardless of whether
  `search` is provided.
- A missing seed song MUST continue to throw `NotFoundException` regardless of `search`.
- All YouTube fetching, Last.fm metadata enrichment, and Firestore song creation logic MUST
  remain unchanged for both paths.

**Scope:**
All requests where `isBugCondition` returns `false` (no `search`, or empty/whitespace `search`)
must be completely unaffected by this fix. This includes:
- Requests with no `search` query parameter at all
- Requests with `search = ""`
- Requests with `search` containing only whitespace

---

## Hypothesized Root Cause

1. **Missing controller parameter**: `songs.controller.ts` does not declare
   `@Query('search') search?: string` on the `generatePlaylist` handler, so the value is never
   extracted from the HTTP request.

2. **Missing service parameter**: `songs.service.ts` `generatePlaylist(songId, limit)` has no
   third parameter, so even if the controller were fixed in isolation, the value could not be
   passed down.

3. **Hard-coded cache key**: The Firestore document path `playlists_generated/${songId}` is
   constructed without any search context, so a cached playlist generated without search context
   is returned for all subsequent requests regardless of `search`.

4. **Prompt has no search context slot**: The Gemini classification prompt is a static string
   with no placeholder for mood/vibe/intent, so even if `search` were passed through, it would
   have no effect on song selection.

---

## Correctness Properties

Property 1: Bug Condition - Search Context Injected into Prompt and Cache Key

_For any_ request X where `isBugCondition(X)` is true (non-empty `search` provided), the fixed
`generatePlaylist` function SHALL use the cache key
`playlists_generated/{songId}_{normalizedSearch}` and SHALL include the search string as
mood/vibe/intent context in the Gemini classification prompt, so that the returned playlist
reflects the user's original search intent.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - No-Search Path Unchanged

_For any_ request X where `isBugCondition(X)` is false (no `search` or empty `search`), the
fixed `generatePlaylist` function SHALL produce the same result as the original function,
preserving the existing cache key `playlists_generated/{songId}`, the existing prompt, and all
existing caching, limit, and error-handling behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

---

## Fix Implementation

### Changes Required

**File**: `src/songs/songs.controller.ts`

**Function**: `generatePlaylist` handler

**Specific Changes**:
1. **Add `search` query param**: Declare `@Query('search') search?: string` alongside the
   existing `limit` param and forward it to the service call.

---

**File**: `src/songs/songs.service.ts`

**Function**: `generatePlaylist(songId, limit, search?)`

**Specific Changes**:
1. **Add `search` parameter**: Add optional third parameter
   `search?: string` to the method signature.

2. **Compute `normalizedSearch`**: At the top of the method, derive:
   ```ts
   const normalizedSearch = search?.trim()
     ? search.toLowerCase().trim().replace(/\s+/g, '_')
     : null;
   ```

3. **Search-aware cache key**: Replace the hard-coded
   `playlists_generated/${songId}` path with:
   ```ts
   const cacheKey = normalizedSearch
     ? `playlists_generated/${songId}_${normalizedSearch}`
     : `playlists_generated/${songId}`;
   ```
   Use `cacheKey` everywhere the Firestore document path appears in the method.

4. **Inject search context into Gemini prompt**: When `normalizedSearch` is truthy, prepend a
   context line to the prompt:
   ```ts
   const searchContext = normalizedSearch
     ? `The user searched for: "${search.trim()}". Prioritize songs that match this mood, vibe, and intent.\n\n`
     : '';
   const prompt = `${searchContext}Classify YouTube results into: songs, mixes, videos, artists.\n...`;
   ```

5. **Persist with correct cache key**: Ensure the final `this.firestore.doc(...).set(...)` call
   also uses `cacheKey` so the search-specific playlist is stored under the correct path.

---

## Testing Strategy

### Validation Approach

Two-phase approach: first run exploratory tests against the **unfixed** code to confirm the bug
manifests as expected, then run fix-checking and preservation tests against the **fixed** code.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug on unfixed code and confirm the root
cause analysis.

**Test Plan**: Call `generatePlaylist` with a non-empty `search` value and inspect (a) the
Firestore document path written and (b) the prompt string passed to Gemini. On unfixed code both
should show no trace of the search value.

**Test Cases**:
1. **Cache key ignores search**: Call `generatePlaylist('song1', 30, 'sad reggaeton')` and assert
   the Firestore write uses `playlists_generated/song1_sad_reggaeton` — will fail on unfixed code.
2. **Prompt ignores search**: Call with `search = 'party hits'` and assert the Gemini prompt
   contains the string "party hits" — will fail on unfixed code.
3. **Different searches, same cache slot**: Call twice with different `search` values for the same
   `songId`; assert the second call does NOT return the first call's cached result — will fail on
   unfixed code.
4. **Whitespace-only search treated as no-search**: Call with `search = '   '` and assert the
   cache key is `playlists_generated/{songId}` (no suffix) — may pass on unfixed code since the
   value is ignored anyway, but must pass on fixed code.

**Expected Counterexamples**:
- Firestore write path does not contain the search string
- Gemini prompt string does not contain the search string
- Possible causes: missing controller param, missing service param, hard-coded cache key,
  static prompt string

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces
the expected behavior.

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition(X) DO
  result := generatePlaylist_fixed(X.songId, X.limit, X.search)
  ASSERT firestoreWritePath = 'playlists_generated/' + X.songId + '_' + normalize(X.search)
  ASSERT geminiPrompt CONTAINS X.search.trim()
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function
produces the same result as the original function.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT generatePlaylist_original(X) = generatePlaylist_fixed(X)
  ASSERT firestoreWritePath = 'playlists_generated/' + X.songId
  ASSERT geminiPrompt does NOT contain any search prefix
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many `search`-absent (or empty) inputs automatically
- It catches edge cases like `search = ""`, `search = undefined`, `search = "  "`
- It provides strong guarantees that the no-search path is completely unaffected

**Test Plan**: Observe the no-search path on unfixed code to capture baseline behavior, then
write property-based tests asserting that behavior is identical after the fix.

**Test Cases**:
1. **No-search cache key preservation**: Verify `generatePlaylist(songId, 30)` still writes to
   `playlists_generated/{songId}` after the fix.
2. **Empty search treated as no-search**: Verify `generatePlaylist(songId, 30, '')` uses the
   same path and prompt as the no-search call.
3. **Limit preservation**: Verify the returned array length is ≤ `limit` for both search and
   no-search paths.
4. **404 preservation**: Verify a missing `songId` still throws `NotFoundException` when `search`
   is provided.

### Unit Tests

- Test `normalizedSearch` derivation: spaces → underscores, lowercased, trimmed
- Test cache key construction for search vs no-search inputs
- Test that the Gemini prompt contains the search context string when `search` is provided
- Test that the Gemini prompt is unchanged when `search` is absent
- Test edge cases: `search = ""`, `search = "  "`, `search = undefined`

### Property-Based Tests

- Generate random non-empty search strings and verify the cache key always equals
  `playlists_generated/{songId}_{normalize(search)}`
- Generate random inputs where `isBugCondition` is false and verify the cache key never
  contains a search suffix
- Generate random `limit` values (1–100) and verify the returned playlist length is always ≤
  `limit` regardless of whether `search` is provided

### Integration Tests

- End-to-end: `GET /songs/:id/generate-playlist?search=sad+reggaeton` returns a playlist and
  the Firestore document at `playlists_generated/{id}_sad_reggaeton` is populated
- End-to-end: same `songId` with two different `search` values produces two separate Firestore
  documents
- End-to-end: `GET /songs/:id/generate-playlist` (no search) continues to use
  `playlists_generated/{id}` and returns a valid playlist
