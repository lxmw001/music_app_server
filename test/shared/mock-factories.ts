import { RawYouTubeResult } from '../../src/sync/interfaces/sync.interfaces';

// ─── Firestore Mock ───────────────────────────────────────────────────────────

export function createMockFirestore() {
  const mockDocRef = {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    id: 'mock-doc-id',
  };

  const mockQuerySnapshot = {
    docs: [] as any[],
    empty: true,
    size: 0,
  };

  const mockCollectionRef = {
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    get: jest.fn().mockResolvedValue(mockQuerySnapshot),
    add: jest.fn(),
    doc: jest.fn().mockReturnValue(mockDocRef),
  };

  return {
    doc: jest.fn().mockReturnValue(mockDocRef),
    collection: jest.fn().mockReturnValue(mockCollectionRef),
    _docRef: mockDocRef,
    _collectionRef: mockCollectionRef,
    _querySnapshot: mockQuerySnapshot,
  };
}

// ─── Cache Mock ───────────────────────────────────────────────────────────────

export function createMockCache() {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };
}

// ─── Firebase Admin Mock ──────────────────────────────────────────────────────

export function createMockFirebaseAdmin() {
  const mockVerifyIdToken = jest.fn();
  return {
    auth: jest.fn().mockReturnValue({
      verifyIdToken: mockVerifyIdToken,
    }),
    _verifyIdToken: mockVerifyIdToken,
  };
}

// ─── Gemini Mock ──────────────────────────────────────────────────────────────

export function createMockGemini() {
  return {
    getPopularGenres: jest.fn().mockResolvedValue([]),
    getArtistsForGenre: jest.fn().mockResolvedValue([]),
    generateSearchQueries: jest.fn().mockResolvedValue([]),
    cleanAndDeduplicate: jest.fn().mockResolvedValue([]),
    rankAndDisambiguate: jest.fn().mockResolvedValue(''),
  };
}

// ─── YouTube Mock ─────────────────────────────────────────────────────────────

export function createMockYouTube() {
  return {
    search: jest.fn().mockResolvedValue([]),
  };
}

// ─── Document Factories ───────────────────────────────────────────────────────

export function makeSongDoc(overrides?: Record<string, any>) {
  return {
    id: 'song-1',
    exists: true,
    data: () => ({
      title: 'Test Song',
      durationSeconds: 180,
      coverImageUrl: null,
      youtubeId: 'yt-abc',
      youtubeIdPendingReview: false,
      artistId: 'artist-1',
      albumId: null,
      genre: 'Rock',
      createdAt: { toDate: () => new Date() },
      updatedAt: { toDate: () => new Date() },
      ...overrides,
    }),
  };
}

export function makeArtistDoc(overrides?: Record<string, any>) {
  return {
    id: 'artist-1',
    exists: true,
    data: () => ({
      name: 'Test Artist',
      biography: 'A test artist biography.',
      profileImageUrl: null,
      ...overrides,
    }),
  };
}

export function makeAlbumDoc(overrides?: Record<string, any>) {
  return {
    id: 'album-1',
    exists: true,
    data: () => ({
      title: 'Test Album',
      releaseYear: 2020,
      coverImageUrl: null,
      artistId: 'artist-1',
      ...overrides,
    }),
  };
}

export function makePlaylistDoc(overrides?: Record<string, any>) {
  return {
    id: 'playlist-1',
    exists: true,
    data: () => ({
      name: 'Test Playlist',
      description: null,
      ownerUid: 'user-1',
      type: 'user' as const,
      createdAt: { toDate: () => new Date() },
      ...overrides,
    }),
  };
}

export function makeRawYouTubeResult(overrides?: Partial<RawYouTubeResult>): RawYouTubeResult {
  return {
    videoId: 'yt-' + Math.random().toString(36).slice(2),
    title: 'Song Title',
    channelTitle: 'Artist Channel',
    genre: 'Rock',
    artistRank: 1,
    artistName: 'Test Artist',
    durationSeconds: 200,
    ...overrides,
  };
}
