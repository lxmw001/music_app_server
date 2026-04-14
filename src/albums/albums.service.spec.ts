import { Test } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { NotFoundException } from '@nestjs/common';
import { AlbumsService } from './albums.service';
import { FirestoreService } from '../firestore/firestore.service';
import {
  createMockFirestore,
  createMockCache,
  makeAlbumDoc,
} from '../../test/shared/mock-factories';

describe('AlbumsService', () => {
  let service: AlbumsService;
  let mockFirestore: ReturnType<typeof createMockFirestore>;
  let mockCache: ReturnType<typeof createMockCache>;

  beforeEach(async () => {
    mockFirestore = createMockFirestore();
    mockCache = createMockCache();

    const module = await Test.createTestingModule({
      providers: [
        AlbumsService,
        { provide: FirestoreService, useValue: mockFirestore },
        { provide: CACHE_MANAGER, useValue: mockCache },
      ],
    }).compile();

    service = module.get(AlbumsService);
  });

  describe('findById', () => {
    it('cache hit: returns cached value without calling Firestore', async () => {
      const cached = { id: 'album-1', title: 'Cached Album' } as any;
      mockCache.get.mockResolvedValue(cached);

      const result = await service.findById('album-1');

      expect(result).toBe(cached);
      expect(mockFirestore._docRef.get).not.toHaveBeenCalled();
    });

    it('doc not found: throws NotFoundException with "Album not found"', async () => {
      mockCache.get.mockResolvedValue(null);
      mockFirestore._docRef.get.mockResolvedValue({ exists: false });

      await expect(service.findById('missing')).rejects.toThrow(
        new NotFoundException('Album not found'),
      );
    });

    it('cache miss: caches result and DTO has all expected fields', async () => {
      mockCache.get.mockResolvedValue(null);
      mockFirestore._docRef.get.mockResolvedValue(makeAlbumDoc());

      const result = await service.findById('album-1');

      expect(result).toMatchObject({
        id: 'album-1',
        title: 'Test Album',
        releaseYear: 2020,
        coverImageUrl: null,
        artistId: 'artist-1',
      });
      expect(mockCache.set).toHaveBeenCalledWith(
        expect.any(String),
        result,
        300_000,
      );
    });
  });

  describe('findAll', () => {
    it('default pagination (page=1, pageSize=20): calls limit(20)', async () => {
      mockFirestore._collectionRef.get.mockResolvedValue({ docs: [], empty: true, size: 0 });

      await service.findAll({ page: 1, pageSize: 20 });

      expect(mockFirestore._collectionRef.limit).toHaveBeenCalledWith(20);
    });
  });
});
