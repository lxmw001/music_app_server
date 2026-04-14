import { GeminiService } from './gemini.service';
import { RawYouTubeResult } from './interfaces/sync.interfaces';

// Mock the entire @google/generative-ai module
jest.mock('@google/generative-ai');

import { GoogleGenerativeAI } from '@google/generative-ai';

const MockGoogleGenerativeAI = GoogleGenerativeAI as jest.MockedClass<typeof GoogleGenerativeAI>;

function makeGenerateContent(text: string) {
  return jest.fn().mockResolvedValue({
    response: { text: () => text },
  });
}

function makeModel(generateContent: jest.Mock) {
  return { generateContent };
}

describe('GeminiService', () => {
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env.GEMINI_API_KEY;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalApiKey;
  });

  // ─── getPopularGenres ────────────────────────────────────────────────────────

  describe('getPopularGenres', () => {
    it('returns parsed array when model returns valid JSON array', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const generateContent = makeGenerateContent('["Rock","Pop","Jazz"]');
      MockGoogleGenerativeAI.prototype.getGenerativeModel = jest
        .fn()
        .mockReturnValue(makeModel(generateContent));

      const service = new GeminiService();
      const result = await service.getPopularGenres();

      expect(result).toEqual(['Rock', 'Pop', 'Jazz']);
    });

    it('returns default genre list when model throws, without re-throwing', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const generateContent = jest.fn().mockRejectedValue(new Error('API error'));
      MockGoogleGenerativeAI.prototype.getGenerativeModel = jest
        .fn()
        .mockReturnValue(makeModel(generateContent));

      const service = new GeminiService();
      const result = await service.getPopularGenres();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      // Should be the default genres
      expect(result).toContain('Rock');
    });
  });

  // ─── getArtistsForGenre ──────────────────────────────────────────────────────

  describe('getArtistsForGenre', () => {
    it('keeps only first occurrence per rank when model returns artists with duplicate ranks', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const artists = [
        { name: 'Artist A', rank: 1, topSongs: ['Song 1'] },
        { name: 'Artist B', rank: 1, topSongs: ['Song 2'] }, // duplicate rank 1
        { name: 'Artist C', rank: 2, topSongs: ['Song 3'] },
      ];
      const generateContent = makeGenerateContent(JSON.stringify(artists));
      MockGoogleGenerativeAI.prototype.getGenerativeModel = jest
        .fn()
        .mockReturnValue(makeModel(generateContent));

      const service = new GeminiService();
      const result = await service.getArtistsForGenre('Rock');

      const ranks = result.map((a) => a.rank);
      const uniqueRanks = new Set(ranks);
      expect(uniqueRanks.size).toBe(ranks.length);
      // Artist A should be kept (first occurrence of rank 1), Artist B dropped
      expect(result.find((a) => a.name === 'Artist A')).toBeDefined();
      expect(result.find((a) => a.name === 'Artist B')).toBeUndefined();
    });
  });

  // ─── generateSearchQueries ───────────────────────────────────────────────────

  describe('generateSearchQueries', () => {
    it('returns non-empty array of non-empty strings with artistName and topSongs', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const queries = ['The Beatles official music video', 'The Beatles best songs'];
      const generateContent = makeGenerateContent(JSON.stringify(queries));
      MockGoogleGenerativeAI.prototype.getGenerativeModel = jest
        .fn()
        .mockReturnValue(makeModel(generateContent));

      const service = new GeminiService();
      const result = await service.generateSearchQueries('The Beatles', ['Hey Jude', 'Let It Be']);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      result.forEach((q) => expect(typeof q).toBe('string'));
      result.forEach((q) => expect(q.length).toBeGreaterThan(0));
    });

    it('returns default queries containing artist name when GEMINI_API_KEY is not set', async () => {
      process.env.GEMINI_API_KEY = '';
      // Instantiate with no API key
      const service = new GeminiService();
      const result = await service.generateSearchQueries('Adele', ['Hello', 'Rolling in the Deep']);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      // Default queries should contain the artist name
      const hasArtistName = result.some((q) => q.includes('Adele'));
      expect(hasArtistName).toBe(true);
    });
  });

  // ─── cleanAndDeduplicate ─────────────────────────────────────────────────────

  describe('cleanAndDeduplicate', () => {
    it('returns [] without calling model when given empty array', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const generateContent = jest.fn();
      MockGoogleGenerativeAI.prototype.getGenerativeModel = jest
        .fn()
        .mockReturnValue(makeModel(generateContent));

      const service = new GeminiService();
      const result = await service.cleanAndDeduplicate([]);

      expect(result).toEqual([]);
      expect(generateContent).not.toHaveBeenCalled();
    });

    it('uses basicClean fallback and merges duplicate title+artist entries when model unavailable', async () => {
      process.env.GEMINI_API_KEY = '';
      const service = new GeminiService();

      const raw: RawYouTubeResult[] = [
        {
          videoId: 'yt-1',
          title: 'Song A (Official Video)',
          channelTitle: 'Artist X',
          genre: 'Rock',
          artistRank: 1,
          artistName: 'Artist X',
          durationSeconds: 200,
        },
        {
          videoId: 'yt-2',
          title: 'Song A (Lyrics)',
          channelTitle: 'Artist X',
          genre: 'Rock',
          artistRank: 1,
          artistName: 'Artist X',
          durationSeconds: 200,
        },
      ];

      const result = await service.cleanAndDeduplicate(raw);

      // After normalization, both titles become "Song A" by "Artist X" — should be merged into one
      expect(result.length).toBe(1);
      expect(result[0].title).toBe('Song A');
      expect(result[0].artistName).toBe('Artist X');
    });
  });

  // ─── rankAndDisambiguate ─────────────────────────────────────────────────────

  describe('rankAndDisambiguate', () => {
    it('returns the single result videoId without calling model', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      const generateContent = jest.fn();
      MockGoogleGenerativeAI.prototype.getGenerativeModel = jest
        .fn()
        .mockReturnValue(makeModel(generateContent));

      const service = new GeminiService();
      const results = [{ videoId: 'yt-only', title: 'Song', channelTitle: 'Artist' }];
      const videoId = await service.rankAndDisambiguate(results, {
        title: 'Song',
        artistName: 'Artist',
        genre: 'Rock',
      });

      expect(videoId).toBe('yt-only');
      expect(generateContent).not.toHaveBeenCalled();
    });

    it('returns first result videoId as fallback when model returns unknown videoId', async () => {
      process.env.GEMINI_API_KEY = 'test-key';
      // Model returns a videoId that doesn't exist in the results
      const generateContent = makeGenerateContent('unknown-video-id');
      MockGoogleGenerativeAI.prototype.getGenerativeModel = jest
        .fn()
        .mockReturnValue(makeModel(generateContent));

      const service = new GeminiService();
      const results = [
        { videoId: 'yt-first', title: 'Song', channelTitle: 'Artist' },
        { videoId: 'yt-second', title: 'Song Alt', channelTitle: 'Artist' },
      ];
      const videoId = await service.rankAndDisambiguate(results, {
        title: 'Song',
        artistName: 'Artist',
        genre: 'Rock',
      });

      expect(videoId).toBe('yt-first');
    });
  });

  // ─── basicClean (private method access) ─────────────────────────────────────

  describe('basicClean (private)', () => {
    it('returns [] for empty input', async () => {
      process.env.GEMINI_API_KEY = '';
      const service = new GeminiService();
      const result = (service as any).basicClean([]);
      expect(result).toEqual([]);
    });
  });
});
