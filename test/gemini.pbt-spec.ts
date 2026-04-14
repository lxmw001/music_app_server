// Feature: nestjs-project-tests, Property 1: basicClean deduplication — no duplicates and output never grows
// Feature: nestjs-project-tests, Property 2: basicClean no over-deduplication

import * as fc from 'fast-check';
import { GeminiService } from '../src/sync/gemini.service';
import { RawYouTubeResult } from '../src/sync/interfaces/sync.interfaces';
import { arbRawYouTubeResult } from './shared/arbitraries';

describe('GeminiService.basicClean — property-based tests', () => {
  let service: GeminiService;

  beforeEach(() => {
    // Instantiate without API key so genAI is null (forces basicClean fallback)
    delete process.env.GEMINI_API_KEY;
    service = new GeminiService();
  });

  it('Property 1: output has no duplicate (title+artist) pairs and length never exceeds input', () => {
    fc.assert(
      fc.property(
        fc.array(arbRawYouTubeResult, { minLength: 1, maxLength: 50 }),
        (rawResults: RawYouTubeResult[]) => {
          const output = (service as any).basicClean(rawResults);

          // No duplicates
          const keys = output.map(
            (r: any) => `${r.title.toLowerCase()}|${r.artistName.toLowerCase()}`,
          );
          const uniqueKeys = new Set(keys);
          expect(uniqueKeys.size).toBe(keys.length);

          // Output never grows
          expect(output.length).toBeLessThanOrEqual(rawResults.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property 2: no over-deduplication — distinct inputs produce same-length output', () => {
    fc.assert(
      fc.property(
        fc.array(arbRawYouTubeResult, { minLength: 1, maxLength: 30 }),
        (rawResults: RawYouTubeResult[]) => {
          // Build a set of inputs with guaranteed distinct normalized title+artist keys
          const seen = new Map<string, RawYouTubeResult>();
          for (const r of rawResults) {
            const normalizedTitle = r.title
              .replace(/\s*\(official\s*(music\s*)?video\)/gi, '')
              .replace(/\s*\(lyrics?\)/gi, '')
              .replace(/\s*\(ft\..*?\)/gi, '')
              .replace(/\s*\(feat\..*?\)/gi, '')
              .replace(/\s*\[.*?\]/g, '')
              .trim()
              .toLowerCase();
            const normalizedArtist = r.artistName
              .replace(/\s*ft\..*$/i, '')
              .replace(/\s*feat\..*$/i, '')
              .trim()
              .toLowerCase();
            const key = `${normalizedTitle}|${normalizedArtist}`;
            if (!seen.has(key)) seen.set(key, r);
          }
          const distinctInputs = Array.from(seen.values());

          const output = (service as any).basicClean(distinctInputs);

          // All distinct inputs should survive — no over-deduplication
          expect(output.length).toBe(distinctInputs.length);
        },
      ),
      { numRuns: 100 },
    );
  });
});
