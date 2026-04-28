import { Test } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { NotFoundException } from '@nestjs/common';
import { SongsService } from './songs.service';
import { FirestoreService } from '../firestore/firestore.service';
import { GeminiService } from '../sync/gemini.service';
import { YouTubeService } from '../sync/youtube.service';
import { LastFmService } from '../sync/lastfm.service';
import { SongDeduplicationService } from './song-deduplication.service';
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
        { provide: LastFmService, useValue: { searchTrack: jest.fn(), getSimilarTracks: jest.fn() } },
        { provide: SongDeduplicationService, useValue: {
          getCanonicalSongId: jest.fn().mockResolvedValue(null),
          deduplicateByCode: jest.fn().mockReturnValue({ unique: [], duplicateMap: new Map() }),
          recordDuplicate: jest.fn().mockResolvedValue(undefined),
          recordDistinct: jest.fn().mockResolvedValue(undefined),
        }},
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
        duration: 180,
        thumbnailUrl: null,
        youtubeId: 'yt-abc',
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

// ─── generatePlaylist — bug condition (Property 1) ───────────────────────────
// Validates: Requirements 1.1, 1.2, 1.3
// These tests MUST FAIL on unfixed code — failure confirms the bug exists.

describe("generatePlaylist — bug condition (Property 1)", () => {
  let service: SongsService;
  let mockFirestore: ReturnType<typeof createMockFirestore>;
  let mockGemini: { generate: jest.Mock; parseSearchIntent: jest.Mock };
  let mockYoutube: { getRelatedVideos: jest.Mock };

  beforeEach(async () => {
    mockFirestore = createMockFirestore();
    mockGemini = {
      generate: jest
        .fn()
        .mockResolvedValue('{"songs":[],"mixes":[],"videos":[],"artists":[]}'),
      parseSearchIntent: jest.fn().mockResolvedValue(null),
    };
    mockYoutube = { getRelatedVideos: jest.fn().mockResolvedValue([]) };

    // First call: playlist cache doc (does not exist)
    // Second call: seed song doc (exists)
    mockFirestore._docRef.get
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ title: "Test Song", artistName: "Test Artist" }),
      });

    const module = await Test.createTestingModule({
      providers: [
        SongsService,
        { provide: FirestoreService, useValue: mockFirestore },
        { provide: GeminiService, useValue: mockGemini },
        { provide: YouTubeService, useValue: mockYoutube },
        {
          provide: LastFmService,
          useValue: {
            searchTrack: jest.fn(),
            getSimilarTracks: jest.fn(),
          },
        },
        {
          provide: SongDeduplicationService,
          useValue: {
            getCanonicalSongId: jest.fn().mockResolvedValue(null),
            deduplicateByCode: jest
              .fn()
              .mockReturnValue({ unique: [], duplicateMap: new Map() }),
            recordDuplicate: jest.fn().mockResolvedValue(undefined),
            recordDistinct: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: CACHE_MANAGER, useValue: createMockCache() },
      ],
    }).compile();

    service = module.get(SongsService);
  });

  it("cache key includes normalized search string", async () => {
    await (service as any).generatePlaylist("song1", 30, "sad reggaeton songs");

    expect(mockFirestore.doc).toHaveBeenCalledWith(
      "playlists_generated/song1_sad_reggaeton_songs"
    );
  });

  it("Gemini prompt contains search string", async () => {
    // Reset and re-configure mocks for this test
    mockFirestore._docRef.get
      .mockReset()
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ title: "Test Song", artistName: "Test Artist" }),
      });

    await (service as any).generatePlaylist("song1", 30, "party hits");

    expect(mockGemini.generate).toHaveBeenCalledWith(
      expect.stringContaining("party hits")
    );
  });
});

// ─── generatePlaylist — preservation (Property 2) ────────────────────────────
// Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
// These tests MUST PASS on unfixed code — they confirm baseline behavior.

describe("generatePlaylist — preservation (Property 2)", () => {
  let service: SongsService;
  let mockFirestore: ReturnType<typeof createMockFirestore>;
  let mockGemini: { generate: jest.Mock; parseSearchIntent: jest.Mock };
  let mockYoutube: { getRelatedVideos: jest.Mock };

  beforeEach(async () => {
    mockFirestore = createMockFirestore();
    mockGemini = {
      generate: jest
        .fn()
        .mockResolvedValue('{"songs":[],"mixes":[],"videos":[],"artists":[]}'),
      parseSearchIntent: jest.fn().mockResolvedValue(null),
    };
    mockYoutube = { getRelatedVideos: jest.fn().mockResolvedValue([]) };

    // Default: playlist cache miss, then valid seed song
    mockFirestore._docRef.get
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ title: "Test Song", artistName: "Test Artist" }),
      });

    const module = await Test.createTestingModule({
      providers: [
        SongsService,
        { provide: FirestoreService, useValue: mockFirestore },
        { provide: GeminiService, useValue: mockGemini },
        { provide: YouTubeService, useValue: mockYoutube },
        {
          provide: LastFmService,
          useValue: {
            searchTrack: jest.fn(),
            getSimilarTracks: jest.fn(),
          },
        },
        {
          provide: SongDeduplicationService,
          useValue: {
            getCanonicalSongId: jest.fn().mockResolvedValue(null),
            deduplicateByCode: jest
              .fn()
              .mockReturnValue({ unique: [], duplicateMap: new Map() }),
            recordDuplicate: jest.fn().mockResolvedValue(undefined),
            recordDistinct: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: CACHE_MANAGER, useValue: createMockCache() },
      ],
    }).compile();

    service = module.get(SongsService);
  });

  it("no search: cache key is playlists_generated/{songId}", async () => {
    await (service as any).generatePlaylist("song1", 30);

    expect(mockFirestore.doc).toHaveBeenCalledWith("playlists_generated/song1");
  });

  it("empty search: cache key is playlists_generated/{songId}", async () => {
    mockFirestore._docRef.get
      .mockReset()
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ title: "Test Song", artistName: "Test Artist" }),
      });

    await (service as any).generatePlaylist("song1", 30, "");

    expect(mockFirestore.doc).toHaveBeenCalledWith("playlists_generated/song1");
  });

  it("whitespace-only search: cache key is playlists_generated/{songId}", async () => {
    mockFirestore._docRef.get
      .mockReset()
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ title: "Test Song", artistName: "Test Artist" }),
      });

    await (service as any).generatePlaylist("song1", 30, "   ");

    expect(mockFirestore.doc).toHaveBeenCalledWith("playlists_generated/song1");
  });

  it("no search: Gemini prompt has no search context prefix", async () => {
    mockFirestore._docRef.get
      .mockReset()
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ title: "Test Song", artistName: "Test Artist" }),
      });

    await (service as any).generatePlaylist("song1", 30);

    expect(mockGemini.generate).not.toHaveBeenCalledWith(
      expect.stringContaining("The user searched for")
    );
  });

  it("missing songId throws NotFoundException even with search", async () => {
    mockFirestore._docRef.get
      .mockReset()
      .mockResolvedValue({ exists: false });

    await expect(
      (service as any).generatePlaylist("missing", 30, "some query")
    ).rejects.toThrow(NotFoundException);
  });
});
