import { Test } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { NotFoundException } from '@nestjs/common';
import { ArtistsService } from './artists.service';
import { FirestoreService } from '../firestore/firestore.service';
import {
  createMockFirestore,
  createMockCache,
  makeArtistDoc,
  makeSongDoc,
  makeAlbumDoc,
} from '../../test/shared/mock-factories';

describe('ArtistsService', () => {
  let service: ArtistsService;
  let mockFirestore: ReturnType<typeof createMockFirestore>;
  let mockCache: ReturnType<typeof createMockCache>;

  beforeEach(async () => {
    mockFirestore = createMockFirestore();
    mockCache = createMockCache();

    const module = await Test.createTestingModule({
      providers: [
        ArtistsService,
        { provide: FirestoreService, useValue: mockFirestore },
        { provide: CACHE_MANAGER, useValue: mockCache },
      ],
    }).compile();

    service = module.get(ArtistsService);
  });

  describe('findById', () => {
    it('cache hit: returns cached value without calling Firestore', async () => {
      const cached = { id: 'artist-1', name: 'Cached Artist' } as any;
      mockCache.get.mockResolvedValue(cached);

      const result = await service.findById('artist-1');

      expect(result).toBe(cached);
      expect(mockFirestore._docRef.get).not.toHaveBeenCalled();
    });

    it('doc not found: throws NotFoundException with "Artist not found"', async () => {
      mockCache.get.mockResolvedValue(null);
      mockFirestore._docRef.get.mockResolvedValue({ exists: false });

      await expect(service.findById('missing')).rejects.toThrow(
        new NotFoundException('Artist not found'),
      );
    });

    it('cache miss: stores result in cache with TTL 300_000', async () => {
      mockCache.get.mockResolvedValue(null);
      mockFirestore._docRef.get.mockResolvedValue(makeArtistDoc());

      const result = await service.findById('artist-1');

      expect(mockCache.set).toHaveBeenCalledWith(
        expect.any(String),
        result,
        300_000,
      );
      expect(result).toMatchObject({
        id: 'artist-1',
        name: 'Test Artist',
        biography: 'A test artist biography.',
        profileImageUrl: null,
      });
    });
  });

  describe('findSongs', () => {
    it('queries collection with where artistId and maps to SongResponseDto[]', async () => {
      const docs = [makeSongDoc(), makeSongDoc({ title: 'Song 2' })];
      mockFirestore._collectionRef.get.mockResolvedValue({ docs, empty: false, size: 2 });

      const result = await service.findSongs('artist-1');

      expect(mockFirestore.collection).toHaveBeenCalledWith('songs');
      expect(mockFirestore._collectionRef.where).toHaveBeenCalledWith(
        'artistId',
        '==',
        'artist-1',
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: 'song-1', title: 'Test Song', artistId: 'artist-1' });
    });
  });

  describe('findAlbums', () => {
    it('queries collection with where artistId and maps to AlbumResponseDto[]', async () => {
      const docs = [makeAlbumDoc(), makeAlbumDoc({ title: 'Album 2' })];
      mockFirestore._collectionRef.get.mockResolvedValue({ docs, empty: false, size: 2 });

      const result = await service.findAlbums('artist-1');

      expect(mockFirestore.collection).toHaveBeenCalledWith('albums');
      expect(mockFirestore._collectionRef.where).toHaveBeenCalledWith(
        'artistId',
        '==',
        'artist-1',
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        id: 'album-1',
        title: 'Test Album',
        releaseYear: 2020,
        artistId: 'artist-1',
      });
    });
  });
});
