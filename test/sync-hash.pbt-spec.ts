// Feature: nestjs-project-tests, Property 3: hashQuery determinism
// Feature: nestjs-project-tests, Property 4: hashQuery case-insensitivity
// Feature: nestjs-project-tests, Property 5: hashQuery whitespace trimming

import * as fc from 'fast-check';
import { SyncService } from '../src/sync/sync.service';
import { arbNonEmptyString } from './shared/arbitraries';

describe('SyncService.hashQuery — property-based tests', () => {
  let service: SyncService;

  beforeEach(() => {
    // Instantiate with null dependencies — we only test the private hashQuery method
    service = new SyncService(null as any, null as any, null as any);
  });

  it('Property 3: hashQuery is deterministic — same input always produces same output', () => {
    fc.assert(
      fc.property(arbNonEmptyString, (q: string) => {
        const hash1 = (service as any).hashQuery(q);
        const hash2 = (service as any).hashQuery(q);
        expect(hash1).toBe(hash2);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 4: hashQuery is case-insensitive — lowercase and uppercase produce same hash', () => {
    fc.assert(
      fc.property(arbNonEmptyString, (q: string) => {
        const trimmed = q.trim();
        if (trimmed.length === 0) return; // skip whitespace-only strings
        const hashLower = (service as any).hashQuery(trimmed.toLowerCase());
        const hashUpper = (service as any).hashQuery(trimmed.toUpperCase());
        expect(hashLower).toBe(hashUpper);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 5: hashQuery strips leading/trailing whitespace — padded input equals trimmed input', () => {
    fc.assert(
      fc.property(arbNonEmptyString, (q: string) => {
        const trimmed = q.trim();
        if (trimmed.length === 0) return; // skip whitespace-only strings
        const hashPadded = (service as any).hashQuery('  ' + trimmed + '  ');
        const hashTrimmed = (service as any).hashQuery(trimmed);
        expect(hashPadded).toBe(hashTrimmed);
      }),
      { numRuns: 100 },
    );
  });
});
