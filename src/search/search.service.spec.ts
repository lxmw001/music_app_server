import { Test } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { BadRequestException } from '@nestjs/common';
import { SearchService } from './search.service';
import { FirestoreService } from '../firestore/firestore.service';
import { createMockFirestore, createMockCache } from '../../test/shared/mock-factories';

describe('SearchService', () => {
  let service: SearchService;
  let mockFirestore: ReturnType<typeof createMockFirestore>;
  let mockCache: ReturnType<typeof createMockCache>;

  beforeEach(async () => {
    mockFirestore = createMockFirestore();
    mockCache = createMockCache();

    const module = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: FirestoreService, useValue: mockFirestore },
        { provide: CACHE_MANAGER, useValue: mockCache },
      ],
    }).compile();

    service = module.get(SearchService);
  });

  describe('input validation', () => {
    it('search("") throws BadRequestException', async () => {
      await expect(service.search('')).rejects.toThrow(BadRequestException);
    });

    it('search("   ") throws BadRequestException', async () => {
      await expect(service.search('   ')).rejects.toThrow(BadRequestException);
    });
  });

  describe('cache hit', () => {
    it('returns cached result without calling Firestore', async () => {
      const cached = { songs: [], artists: [], albums: [], playlists: [] };
      mockCache.get.mockResolvedValue(cached);

      const result = await service.search('rock');

      expect(result).toBe(cached);
      expect(mockFirestore.collection).not.toHaveBeenCalled();
    });
  });

  describe('cache miss', () => {
    it('executes four collection queries and caches the result', async () => {
      mockCache.get.mockResolvedValue(null);

      const emptySnap = { docs: [], empty: true, size: 0 };
      mockFirestore._collectionRef.get.mockResolvedValue(emptySnap);

      await service.search('rock');

      // Each collection is queried twice (prefix + token), 4 collections = 8 calls
      expect(mockFirestore.collection).toHaveBeenCalledWith('songs');
      expect(mockFirestore.collection).toHaveBeenCalledWith('artists');
      expect(mockFirestore.collection).toHaveBeenCalledWith('albums');
      expect(mockFirestore.collection).toHaveBeenCalledWith('playlists');
      expect(mockCache.set).toHaveBeenCalled();
    });

    it('result shape has exactly keys songs, artists, albums, playlists each as arrays', async () => {
      mockCache.get.mockResolvedValue(null);
      mockFirestore._collectionRef.get.mockResolvedValue({ docs: [], empty: true, size: 0 });

      const result = await service.search('rock');

      expect(Object.keys(result).sort()).toEqual(['albums', 'artists', 'playlists', 'songs']);
      expect(Array.isArray(result.songs)).toBe(true);
      expect(Array.isArray(result.artists)).toBe(true);
      expect(Array.isArray(result.albums)).toBe(true);
      expect(Array.isArray(result.playlists)).toBe(true);
    });

    it('playlist filtering: docs with ownerUid === null excluded from playlist results', async () => {
      mockCache.get.mockResolvedValue(null);

      const systemPlaylist = {
        id: 'sys-playlist',
        data: () => ({ name: 'Genre: Rock', ownerUid: null, nameLower: 'genre: rock', searchTokens: [] }),
      };
      const userPlaylist = {
        id: 'user-playlist',
        data: () => ({ name: 'My Rock', ownerUid: 'user-1', nameLower: 'my rock', searchTokens: [] }),
      };

      // Use per-collection mock implementation
      mockFirestore.collection.mockImplementation((name: string) => {
        if (name === 'playlists') {
          const playlistRef = {
            where: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnThis(),
            get: jest.fn().mockResolvedValue({
              docs: [systemPlaylist, userPlaylist],
              empty: false,
              size: 2,
            }),
            add: jest.fn(),
            doc: jest.fn().mockReturnValue(mockFirestore._docRef),
          };
          return playlistRef;
        }
        return mockFirestore._collectionRef;
      });

      const result = await service.search('rock');

      expect(result.playlists).toHaveLength(1);
      expect(result.playlists[0].id).toBe('user-playlist');
    });
  });
});
