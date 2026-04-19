import { Test } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { NotFoundException } from '@nestjs/common';
import { SongsService } from './songs.service';
import { FirestoreService } from '../firestore/firestore.service';
import { GeminiService } from '../sync/gemini.service';
import { YouTubeService } from '../sync/youtube.service';
import {
  createMockFirestore,
  createMockCache,
  makeSongDoc,
} from '../../test/shared/mock-factories';

describe('SongsService', () => {
  let service: SongsService;
  let mockFirestore: ReturnType<typeof createMockFirestore>;
  let mockCache: ReturnType<typeof createMockCache>;

  beforeEach(async () => {
    mockFirestore = createMockFirestore();
    mockCache = createMockCache();

    const module = await Test.createTestingModule({
      providers: [
        SongsService,
        { provide: FirestoreService, useValue: mockFirestore },
        { provide: GeminiService, useValue: { cleanTitle: jest.fn() } },
        { provide: YouTubeService, useValue: { searchVideos: jest.fn() } },
        { provide: CACHE_MANAGER, useValue: mockCache },
      ],
    }).compile();

    service = module.get(SongsService);
  });

  describe('findById', () => {
    it('cache hit: returns cached DTO without calling Firestore', async () => {
      const cached = { id: 'song-1', title: 'Cached Song' } as any;
      mockCache.get.mockResolvedValue(cached);

      const result = await service.findById('song-1');

      expect(result).toBe(cached);
      expect(mockFirestore._docRef.get).not.toHaveBeenCalled();
    });

    it('cache miss + doc exists: maps DTO correctly and sets cache with TTL 300_000', async () => {
      mockCache.get.mockResolvedValue(null);
      const doc = makeSongDoc();
      mockFirestore._docRef.get.mockResolvedValue(doc);

      const result = await service.findById('song-1');

      expect(result).toMatchObject({
        id: 'song-1',
        title: 'Test Song',
        artistId: 'artist-1',
        albumId: null,
        durationSeconds: 180,
        coverImageUrl: null,
        youtubeId: 'yt-abc',
        genre: 'Rock',
      });
      expect(mockCache.set).toHaveBeenCalledWith(
        expect.any(String),
        result,
        300_000,
      );
    });

    it('doc not found: throws NotFoundException with "Song not found"', async () => {
      mockCache.get.mockResolvedValue(null);
      mockFirestore._docRef.get.mockResolvedValue({ exists: false });

      await expect(service.findById('missing')).rejects.toThrow(
        new NotFoundException('Song not found'),
      );
    });
  });

  describe('findAll', () => {
    it('valid pagination: calls orderBy and limit, returns SongResponseDto[]', async () => {
      const docs = [makeSongDoc(), makeSongDoc({ title: 'Song 2' })];
      mockFirestore._collectionRef.get.mockResolvedValue({ docs, empty: false, size: 2 });

      const result = await service.findAll({ page: 1, pageSize: 2 });

      expect(mockFirestore._collectionRef.orderBy).toHaveBeenCalledWith('createdAt');
      expect(mockFirestore._collectionRef.limit).toHaveBeenCalledWith(2);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 'song-1', title: 'Test Song' });
    });

    it('page=2, pageSize=2: returns docs at index 2 and 3', async () => {
      const docs = [
        makeSongDoc({ title: 'Song 1' }),
        makeSongDoc({ title: 'Song 2' }),
        makeSongDoc({ title: 'Song 3' }),
        makeSongDoc({ title: 'Song 4' }),
      ];
      mockFirestore._collectionRef.get.mockResolvedValue({ docs, empty: false, size: 4 });

      const result = await service.findAll({ page: 2, pageSize: 2 });

      expect(mockFirestore._collectionRef.limit).toHaveBeenCalledWith(4);
      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Song 3');
      expect(result[1].title).toBe('Song 4');
    });
  });
});
