import { Test, TestingModule } from '@nestjs/testing';
import { SyncService } from './sync.service';
import { FirestoreService } from '../firestore/firestore.service';
import { GeminiService } from './gemini.service';
import { YouTubeService } from './youtube.service';
import { createMockGemini, createMockYouTube } from '../../test/shared/mock-factories';

// Mock firebase-admin so Timestamp.now() works without real credentials
jest.mock('firebase-admin', () => ({
  firestore: {
    Timestamp: {
      now: jest.fn().mockReturnValue({ seconds: 1000, nanoseconds: 0 }),
    },
  },
}));

// ─── Firestore mock builder ───────────────────────────────────────────────────
// We need a more flexible mock that tracks calls per collection path.

function createFlexibleFirestore() {

  function makeDocRef(id = 'mock-doc-id') {
    return {
      get: jest.fn().mockResolvedValue({ exists: false }),
      set: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      id,
    };
  }

  function makeCollectionRef(path: string) {
    const docRef = makeDocRef();
    const querySnapshot = { docs: [] as any[], empty: true, size: 0 };
    const ref: any = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue(querySnapshot),
      add: jest.fn().mockResolvedValue({ id: 'added-doc-id' }),
      doc: jest.fn().mockReturnValue(docRef),
      _docRef: docRef,
      _querySnapshot: querySnapshot,
      _path: path,
    };
    return ref;
  }

  const defaultDocRef = makeDocRef();
  const defaultCollectionRef = makeCollectionRef('default');

  return {
    doc: jest.fn().mockReturnValue(defaultDocRef),
    collection: jest.fn().mockReturnValue(defaultCollectionRef),
    _defaultDocRef: defaultDocRef,
    _defaultCollectionRef: defaultCollectionRef,
    _makeDocRef: makeDocRef,
    _makeCollectionRef: makeCollectionRef,
  };
}

// ─── Default mock Gemini setup ────────────────────────────────────────────────

function setupDefaultGemini(mockGemini: ReturnType<typeof createMockGemini>) {
  mockGemini.getPopularGenres.mockResolvedValue(['Rock']);
  mockGemini.getArtistsForGenre.mockResolvedValue([
    { name: 'Test Artist', rank: 1, topSongs: ['Song A'] },
  ]);
  mockGemini.generateSearchQueries.mockResolvedValue(['Test Artist official']);
  mockGemini.cleanAndDeduplicate.mockResolvedValue([
    {
      title: 'Song A',
      artistName: 'Test Artist',
      genre: 'Rock',
      artistRank: 1,
      youtubeId: 'yt-123',
    },
  ]);
  mockGemini.rankAndDisambiguate.mockResolvedValue('yt-123');
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('SyncService', () => {
  let service: SyncService;
  let mockFirestore: ReturnType<typeof createFlexibleFirestore>;
  let mockGemini: ReturnType<typeof createMockGemini>;
  let mockYouTube: ReturnType<typeof createMockYouTube>;

  beforeEach(async () => {
    mockFirestore = createFlexibleFirestore();
    mockGemini = createMockGemini();
    mockYouTube = createMockYouTube();

    setupDefaultGemini(mockGemini);
    mockYouTube.search.mockResolvedValue([
      { videoId: 'yt-123', title: 'Song A', channelTitle: 'Test Artist' },
    ]);

    // Default: syncCache doc does NOT exist (cache miss)
    mockFirestore._defaultDocRef.get.mockResolvedValue({ exists: false });

    // Default: songs collection query returns empty (no existing song)
    mockFirestore._defaultCollectionRef.get.mockResolvedValue({
      docs: [],
      empty: true,
      size: 0,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        { provide: FirestoreService, useValue: mockFirestore },
        { provide: GeminiService, useValue: mockGemini },
        { provide: YouTubeService, useValue: mockYouTube },
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);
  });

  // ─── Genre discovery ─────────────────────────────────────────────────────────

  it('calls getPopularGenres once and uses its return value when genres is empty', async () => {
    await service.runSync({ genres: [] });
    expect(mockGemini.getPopularGenres).toHaveBeenCalledTimes(1);
    expect(mockGemini.getArtistsForGenre).toHaveBeenCalledWith('Rock');
  });

  it('does NOT call getPopularGenres when genres are provided', async () => {
    await service.runSync({ genres: ['Rock'] });
    expect(mockGemini.getPopularGenres).not.toHaveBeenCalled();
  });

  // ─── Cache behaviour ─────────────────────────────────────────────────────────

  it('does NOT call youtube.search when force=false and syncCache doc exists', async () => {
    // Make the syncCache doc exist with cached results
    mockFirestore._defaultDocRef.get.mockResolvedValue({
      exists: true,
      data: () => ({
        query: 'Test Artist official',
        results: [{ videoId: 'yt-cached', title: 'Song A', channelTitle: 'Test Artist' }],
      }),
    });

    await service.runSync({ genres: ['Rock'], force: false });

    expect(mockYouTube.search).not.toHaveBeenCalled();
  });

  it('calls youtube.search for every query when force=true regardless of cache', async () => {
    // Even if the doc "exists", force=true should bypass cache
    mockFirestore._defaultDocRef.get.mockResolvedValue({
      exists: true,
      data: () => ({
        query: 'Test Artist official',
        results: [{ videoId: 'yt-cached', title: 'Song A', channelTitle: 'Test Artist' }],
      }),
    });

    await service.runSync({ genres: ['Rock'], force: true });

    expect(mockYouTube.search).toHaveBeenCalledWith('Test Artist official');
  });

  // ─── Deduplication ───────────────────────────────────────────────────────────

  it('does not create a new song doc when an existing song with same title+artistName exists', async () => {
    // Simulate existing song found in Firestore
    mockFirestore._defaultCollectionRef.get.mockResolvedValue({
      docs: [{ id: 'existing-song-id', data: () => ({ title: 'Song A', artistName: 'Test Artist' }) }],
      empty: false,
      size: 1,
    });

    const songDocSet = jest.fn().mockResolvedValue(undefined);
    const songDocRef = { set: songDocSet, id: 'new-song-id' };
    mockFirestore._defaultCollectionRef.doc.mockReturnValue(songDocRef);

    await service.runSync({ genres: ['Rock'] });

    // set() should NOT have been called with song data (existing song found, skipped)
    const songSetCall = songDocSet.mock.calls.find(
      (call) => call[0]?.youtubeId === 'yt-123',
    );
    expect(songSetCall).toBeUndefined();
  });

  // ─── New song creation ───────────────────────────────────────────────────────

  it('calls collection("songs").doc().set() with youtubeId, genre, artistId for a new song', async () => {
    // No existing song, no existing artist
    mockFirestore._defaultCollectionRef.get.mockResolvedValue({
      docs: [],
      empty: true,
      size: 0,
    });

    const setMock = jest.fn().mockResolvedValue(undefined);
    const docRef = { set: setMock, id: 'new-doc-id' };
    mockFirestore._defaultCollectionRef.doc.mockReturnValue(docRef);

    await service.runSync({ genres: ['Rock'] });

    // set() should have been called at least once with song data containing youtubeId and genre
    const songSetCall = setMock.mock.calls.find(
      (call) => call[0]?.youtubeId === 'yt-123' && call[0]?.genre === 'Rock',
    );
    expect(songSetCall).toBeDefined();
    expect(songSetCall![0]).toMatchObject({
      youtubeId: 'yt-123',
      genre: 'Rock',
    });
  });

  // ─── Error resilience ────────────────────────────────────────────────────────

  it('continues processing remaining songs when one song throws an error', async () => {
    // Two songs to process
    mockGemini.cleanAndDeduplicate.mockResolvedValue([
      { title: 'Song A', artistName: 'Test Artist', genre: 'Rock', artistRank: 1, youtubeId: 'yt-1' },
      { title: 'Song B', artistName: 'Test Artist', genre: 'Rock', artistRank: 1, youtubeId: 'yt-2' },
    ]);

    // No existing songs or artists
    mockFirestore._defaultCollectionRef.get.mockResolvedValue({
      docs: [],
      empty: true,
      size: 0,
    });

    let callCount = 0;
    const songDocSet = jest.fn().mockImplementation(() => {
      callCount++;
      // Fail on the first song set call (which will be the artist upsert or song set)
      // We want the song set to fail for the first song
      if (callCount === 2) {
        // Second set call is the first song (first set is artist upsert)
        return Promise.reject(new Error('write failed'));
      }
      return Promise.resolve(undefined);
    });

    const songDocRef = { set: songDocSet, id: 'new-song-id' };
    mockFirestore._defaultCollectionRef.doc.mockReturnValue(songDocRef);

    // Should not throw — errors are caught per-song
    await expect(service.runSync({ genres: ['Rock'] })).resolves.not.toThrow();
  });

  // ─── Genre playlists ─────────────────────────────────────────────────────────

  it('upserts a genre playlist for the input genre after sync', async () => {
    // No existing song, no existing playlist
    mockFirestore._defaultCollectionRef.get.mockResolvedValue({
      docs: [],
      empty: true,
      size: 0,
    });

    const songDocSet = jest.fn().mockResolvedValue(undefined);
    const songDocRef = { set: songDocSet, id: 'new-song-id' };
    mockFirestore._defaultCollectionRef.doc.mockReturnValue(songDocRef);

    await service.runSync({ genres: ['Rock'] });

    // collection() should have been called with 'playlists' at some point
    const collectionCalls = (mockFirestore.collection as jest.Mock).mock.calls.map((c) => c[0]);
    expect(collectionCalls.some((path: string) => path.includes('playlists'))).toBe(true);
  });

  // ─── Album playlists ─────────────────────────────────────────────────────────

  it('upserts an album playlist when a song has an albumName', async () => {
    mockGemini.cleanAndDeduplicate.mockResolvedValue([
      {
        title: 'Song A',
        artistName: 'Test Artist',
        albumName: 'Test Album',
        genre: 'Rock',
        artistRank: 1,
        youtubeId: 'yt-123',
      },
    ]);

    mockFirestore._defaultCollectionRef.get.mockResolvedValue({
      docs: [],
      empty: true,
      size: 0,
    });

    const songDocSet = jest.fn().mockResolvedValue(undefined);
    const songDocRef = { set: songDocSet, id: 'new-song-id' };
    mockFirestore._defaultCollectionRef.doc.mockReturnValue(songDocRef);

    await service.runSync({ genres: ['Rock'] });

    // collection() should have been called with 'playlists' for album playlist
    const collectionCalls = (mockFirestore.collection as jest.Mock).mock.calls.map((c) => c[0]);
    expect(collectionCalls.some((path: string) => path.includes('playlists'))).toBe(true);
  });

  // ─── Duplicate playlist songs ─────────────────────────────────────────────────

  it('does not add songs already in the playlist subcollection', async () => {
    // No existing song in songs collection
    mockFirestore._defaultCollectionRef.get.mockResolvedValue({
      docs: [],
      empty: true,
      size: 0,
    });

    const songDocSet = jest.fn().mockResolvedValue(undefined);
    const songDocRef = { set: songDocSet, id: 'new-song-id' };
    mockFirestore._defaultCollectionRef.doc.mockReturnValue(songDocRef);

    // Simulate that the playlist songs subcollection already has the song
    // We need to intercept the collection call for playlists/{id}/songs
    const playlistSongsDocSet = jest.fn().mockResolvedValue(undefined);
    const playlistSongsDocRef = { set: playlistSongsDocSet, id: 'new-song-id' };

    // The playlist songs subcollection already contains the song
    const playlistSongsCollectionRef = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      get: jest.fn().mockResolvedValue({
        docs: [{ id: 'new-song-id' }], // song already in playlist
        empty: false,
        size: 1,
      }),
      add: jest.fn(),
      doc: jest.fn().mockReturnValue(playlistSongsDocRef),
    };

    // Override collection to return playlist songs collection for subcollection paths
    (mockFirestore.collection as jest.Mock).mockImplementation((path: string) => {
      if (path.includes('/songs')) {
        return playlistSongsCollectionRef;
      }
      return mockFirestore._defaultCollectionRef;
    });

    await service.runSync({ genres: ['Rock'] });

    // The playlist songs doc set should NOT have been called (song already exists)
    expect(playlistSongsDocSet).not.toHaveBeenCalled();
  });
});
