# Bugfix Requirements Document

## Introduction

The `GET /songs/:id/generate-playlist` endpoint ignores the user's search intent when building a playlist. Regardless of what the user searched for (e.g. "sad reggaeton songs" vs "party hits"), the endpoint always generates the same artist-based playlist for a given seed song. This means two users who tapped the same song from completely different search contexts receive identical playlists, which fails to reflect their actual intent.

The fix introduces an optional `search` query parameter. When provided, it is passed as context to the Gemini prompt so the playlist reflects the mood, vibe, and intent behind the user's original search. A separate cache entry is stored per unique search context so different intents produce different cached playlists.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `GET /songs/:id/generate-playlist` is called with a `search` query parameter THEN the system ignores the `search` value entirely and generates a playlist based solely on the seed song's `artistName`

1.2 WHEN two users tap the same seed song from different search contexts (e.g. "sad reggaeton" vs "party hits") THEN the system returns the same playlist for both, with no differentiation by search intent

1.3 WHEN `GET /songs/:id/generate-playlist` is called with a `search` query parameter THEN the system uses the cache key `playlists_generated/{songId}` and returns a cached playlist that was generated without any search context, even if a context-specific playlist would be more appropriate

### Expected Behavior (Correct)

2.1 WHEN `GET /songs/:id/generate-playlist` is called with a `search` query parameter THEN the system SHALL include the search query as context in the Gemini classification prompt so that song selection and ranking reflect the mood, vibe, and intent of the search

2.2 WHEN two users tap the same seed song from different search contexts THEN the system SHALL return playlists tailored to each respective search context, producing different results that reflect each user's intent

2.3 WHEN `GET /songs/:id/generate-playlist` is called with a `search` query parameter THEN the system SHALL use the cache key `playlists_generated/{songId}_{normalizedSearch}` (where `normalizedSearch` is the lowercased, trimmed search string with spaces replaced by underscores) so that each distinct search context has its own cached playlist

### Unchanged Behavior (Regression Prevention)

3.1 WHEN `GET /songs/:id/generate-playlist` is called without a `search` query parameter THEN the system SHALL CONTINUE TO generate a playlist based solely on the seed song's `artistName` with no change to existing logic

3.2 WHEN `GET /songs/:id/generate-playlist` is called without a `search` query parameter THEN the system SHALL CONTINUE TO use the cache key `playlists_generated/{songId}` with a 7-day TTL

3.3 WHEN a valid cached playlist exists for the given `songId` and `search` context combination THEN the system SHALL CONTINUE TO return the cached result without re-invoking YouTube or Gemini

3.4 WHEN `GET /songs/:id/generate-playlist` is called with a `limit` parameter THEN the system SHALL CONTINUE TO return at most `limit` songs regardless of whether `search` is provided

3.5 WHEN the seed song does not exist in Firestore THEN the system SHALL CONTINUE TO return a 404 Not Found error regardless of whether `search` is provided

---

## Bug Condition Pseudocode

**Bug Condition Function** — identifies requests that trigger the bug:

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type PlaylistRequest { songId: string, search?: string }
  OUTPUT: boolean

  RETURN X.search IS NOT NULL AND X.search.trim() != ''
END FUNCTION
```

**Property: Fix Checking** — correct behavior for buggy inputs:

```pascal
FOR ALL X WHERE isBugCondition(X) DO
  result ← generatePlaylist'(X)
  ASSERT result reflects mood/vibe/intent of X.search
  ASSERT cache key used = 'playlists_generated/' + X.songId + '_' + normalize(X.search)
END FOR
```

**Property: Preservation Checking** — non-buggy inputs must be unaffected:

```pascal
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT generatePlaylist(X) = generatePlaylist'(X)
  ASSERT cache key used = 'playlists_generated/' + X.songId
END FOR
```
