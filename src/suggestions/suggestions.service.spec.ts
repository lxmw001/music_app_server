import { Test } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException } from '@nestjs/common';
import { SuggestionsService } from './suggestions.service';
import { FirestoreService } from '../firestore/firestore.service';
import { createMockFirestore, createMockCache } from '../../test/shared/mock-factories';

function makeDoc(id: string, name: string, ownerUid?: string | null) {
  return {
    id,
    data: () => ({
      name,
      title: name,
      nameLower: name.toLowerCase(),
      searchTokens: [name.toLowerCase()],
      ...(ownerUid !== undefined ? { ownerUid } : {}),
    }),
  };
}

describe('SuggestionsService', () => {
  let service: SuggestionsService;
  let mockFirestore: ReturnType<typeof createMockFirestore>;
  let mockCache: ReturnType<typeof createMockCache>;

  beforeEach(async () => {
    mockFirestore = createMockFirestore();
    mockCache = createMockCache();

    const module = await Test.createTestingModule({
      providers: [
        SuggestionsService,
        { provide: FirestoreService, useValue: mockFirestore },
        { provide: CACHE_MANAGER, useValue: mockCache },
      ],
    }).compile();

    service = module.get(SuggestionsService);
  });

  describe('input validation', () => {
    it('suggest("r") throws BadRequestException (length < 2)', async () => {
      await expect(service.suggest('r')).rejects.toThrow(BadRequestException);
    });

    it('suggest("ro") does not throw and executes Firestore queries', async () => {
      mockCache.get.mockResolvedValue(null);
      mockFirestore._collectionRef.get.mockResolvedValue({ docs: [], empty: true, size: 0 });

      await expect(service.suggest('ro')).resolves.toBeDefined();
      expect(mockFirestore.collection).toHaveBeenCalled();
    });
  });

  describe('cache hit', () => {
    it('returns cached result without calling Firestore', async () => {
      const cached = [{ id: 'song-1', name: 'Rock Song', type: 'song' }];
      mockCache.get.mockResolvedValue(cached);

      const result = await service.suggest('rock');

      expect(result).toBe(cached);
      expect(mockFirestore.collection).not.toHaveBeenCalled();
    });
  });

  describe('ordering', () => {
    it('prefix matches appear before substring-only matches', async () => {
      mockCache.get.mockResolvedValue(null);

      // Set up per-collection mocks: prefix snap returns one doc, token snap returns another
      let callCount = 0;
      mockFirestore._collectionRef.get.mockImplementation(() => {
        callCount++;
        // Calls alternate: prefix query, token query, prefix query, token query, ...
        // For simplicity, first call per collection = prefix (returns prefixDoc), second = token (returns tokenDoc)
        if (callCount % 2 === 1) {
          // prefix query
          return Promise.resolve({ docs: [makeDoc('prefix-1', 'Rock')], empty: false, size: 1 });
        } else {
          // token query
          return Promise.resolve({ docs: [makeDoc('token-1', 'Hard Rock')], empty: false, size: 1 });
        }
      });

      const result = await service.suggest('rock');

      const prefixIdx = result.findIndex((r) => r.id === 'prefix-1');
      const tokenIdx = result.findIndex((r) => r.id === 'token-1');
      expect(prefixIdx).toBeGreaterThanOrEqual(0);
      expect(tokenIdx).toBeGreaterThanOrEqual(0);
      expect(prefixIdx).toBeLessThan(tokenIdx);
    });
  });

  describe('result count cap', () => {
    it('caps results at 10 even when more than 10 docs are returned', async () => {
      mockCache.get.mockResolvedValue(null);

      // Return 8 unique docs per prefix query across 4 collections = 32 total, but capped at 10
      const manyDocs = Array.from({ length: 8 }, (_, i) => makeDoc(`doc-${i}`, `Song ${i}`));
      mockFirestore._collectionRef.get.mockResolvedValue({ docs: manyDocs, empty: false, size: 8 });

      const result = await service.suggest('so');

      expect(result.length).toBeLessThanOrEqual(10);
    });
  });

  describe('playlist filtering', () => {
    it('excludes docs with ownerUid === null from playlist results', async () => {
      mockCache.get.mockResolvedValue(null);

      const systemPlaylist = makeDoc('sys-1', 'Genre Rock', null);
      const userPlaylist = makeDoc('user-1', 'My Rock', 'user-uid');

      mockFirestore.collection.mockImplementation((name: string) => {
        const snap = {
          docs: name === 'playlists' ? [systemPlaylist, userPlaylist] : [],
          empty: false,
          size: 2,
        };
        const ref = {
          where: jest.fn().mockReturnThis(),
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          get: jest.fn().mockResolvedValue(snap),
          add: jest.fn(),
          doc: jest.fn().mockReturnValue(mockFirestore._docRef),
        };
        return ref;
      });

      const result = await service.suggest('rock');

      const playlistResults = result.filter((r) => r.type === 'playlist');
      expect(playlistResults.every((r) => r.id !== 'sys-1')).toBe(true);
    });
  });
});
