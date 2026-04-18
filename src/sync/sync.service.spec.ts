import { SyncService } from './sync.service';
import { GeminiService } from './gemini.service';
import { YouTubeService } from './youtube.service';
import { FirestoreService } from '../firestore/firestore.service';

// TODO: Rewrite tests for new sync API (startSync, progress tracking, etc.)
describe('SyncService', () => {
  let service: SyncService;
  let mockGemini: jest.Mocked<GeminiService>;
  let mockYouTube: jest.Mocked<YouTubeService>;
  let mockFirestore: any;

  beforeEach(() => {
    mockGemini = {
      getPopularGenres: jest.fn(),
      getArtistsForGenre: jest.fn(),
      generateSearchQueries: jest.fn(),
      cleanAndDeduplicate: jest.fn(),
    } as any;

    mockYouTube = {
      searchVideos: jest.fn(),
    } as any;

    mockFirestore = {
      collection: jest.fn().mockReturnValue({
        doc: jest.fn().mockReturnValue({
          set: jest.fn(),
          get: jest.fn(),
        }),
        add: jest.fn(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        get: jest.fn(),
      }),
    };

    service = new SyncService(mockGemini, mockYouTube, mockFirestore);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('startSync returns syncId and message', async () => {
    const result = await service.startSync();
    expect(result).toHaveProperty('syncId');
    expect(result).toHaveProperty('message');
    expect(result.syncId).toMatch(/^sync_\d+$/);
  });
});
