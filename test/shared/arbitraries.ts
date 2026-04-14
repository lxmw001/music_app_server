import * as fc from 'fast-check';

// Arbitrary RawYouTubeResult
export const arbRawYouTubeResult = fc.record({
  videoId: fc.hexaString({ minLength: 5, maxLength: 11 }),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  channelTitle: fc.string({ minLength: 1, maxLength: 50 }),
  genre: fc.constantFrom('Rock', 'Pop', 'Jazz', 'Hip-Hop', 'Classical'),
  artistRank: fc.integer({ min: 1, max: 10 }),
  artistName: fc.string({ minLength: 1, maxLength: 50 }),
  durationSeconds: fc.option(fc.integer({ min: 1, max: 600 })),
});

// Array of RawYouTubeResult (non-empty)
export const arbRawYouTubeResultArray = fc.array(arbRawYouTubeResult, {
  minLength: 1,
  maxLength: 50,
});

// Non-empty string (for hashQuery tests)
export const arbNonEmptyString = fc.string({ minLength: 1, maxLength: 200 });

// HTTP status code in 4xx-5xx range
export const arbHttpStatusCode = fc.integer({ min: 400, max: 599 });

// Arbitrary message string
export const arbMessageString = fc.string({ minLength: 0, maxLength: 200 });
