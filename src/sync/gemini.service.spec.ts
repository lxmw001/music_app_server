import { GeminiService } from './gemini.service';

// Mock @google/genai
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: jest.fn(),
    },
  })),
}));

import { GoogleGenAI } from '@google/genai';

const MockGoogleGenAI = GoogleGenAI as jest.MockedClass<typeof GoogleGenAI>;

function makeService(apiKey?: string): { service: GeminiService; mockGenerate: jest.Mock } {
  const mockGenerate = jest.fn();
  MockGoogleGenAI.mockImplementation(() => ({
    models: { generateContent: mockGenerate },
  }) as any);

  if (apiKey) {
    process.env.GEMINI_API_KEY = apiKey;
  } else {
    delete process.env.GEMINI_API_KEY;
  }

  const service = new GeminiService();
  return { service, mockGenerate };
}

describe('GeminiService', () => {
  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
  });

  // ── Initialization ──────────────────────────────────────────────────────────

  it('initializes without API key (genAI is null)', () => {
    const { service } = makeService();
    expect(service).toBeDefined();
  });

  it('initializes with API key', () => {
    const { service } = makeService('test-key');
    expect(service).toBeDefined();
    expect(MockGoogleGenAI).toHaveBeenCalledWith({ apiKey: 'test-key' });
  });

  // ── getPopularGenres ────────────────────────────────────────────────────────

  describe('getPopularGenres', () => {
    it('returns parsed genres when model returns valid JSON', async () => {
      const { service, mockGenerate } = makeService('key');
      mockGenerate.mockResolvedValue({ text: '["Rock","Pop","Jazz"]' });

      const genres = await service.getPopularGenres();

      expect(genres).toEqual(['Rock', 'Pop', 'Jazz']);
    });

    it('returns default list when model throws', async () => {
      const { service, mockGenerate } = makeService('key');
      mockGenerate.mockRejectedValue(new Error('network error'));

      const genres = await service.getPopularGenres();

      expect(Array.isArray(genres)).toBe(true);
      expect(genres.length).toBeGreaterThan(0);
    });

    it('returns default list when no API key', async () => {
      const { service } = makeService(); // no key
      const genres = await service.getPopularGenres();
      expect(Array.isArray(genres)).toBe(true);
      expect(genres.length).toBeGreaterThan(0);
    });
  });

  // ── getArtistsForGenre ──────────────────────────────────────────────────────

  describe('getArtistsForGenre', () => {
    it('returns artists sorted by rank', async () => {
      const { service, mockGenerate } = makeService('key');
      mockGenerate.mockResolvedValue({
        text: JSON.stringify([
          { name: 'B', rank: 2, topSongs: [] },
          { name: 'A', rank: 1, topSongs: [] },
        ]),
      });

      const artists = await service.getArtistsForGenre('Rock');

      expect(artists[0].name).toBe('A');
      expect(artists[1].name).toBe('B');
    });

    it('deduplicates duplicate ranks — keeps first occurrence', async () => {
      const { service, mockGenerate } = makeService('key');
      mockGenerate.mockResolvedValue({
        text: JSON.stringify([
          { name: 'First', rank: 1, topSongs: [] },
          { name: 'Duplicate', rank: 1, topSongs: [] },
        ]),
      });

      const artists = await service.getArtistsForGenre('Pop');

      const rank1 = artists.filter(a => a.rank === 1);
      expect(rank1).toHaveLength(1);
      expect(rank1[0].name).toBe('First');
    });

    it('returns empty array fallback when model throws', async () => {
      const { service, mockGenerate } = makeService('key');
      mockGenerate.mockRejectedValue(new Error('fail'));

      const artists = await service.getArtistsForGenre('Jazz');

      expect(artists).toEqual([]);
    });
  });

  // ── generateSearchQueries ───────────────────────────────────────────────────

  describe('generateSearchQueries', () => {
    it('returns non-empty string array from model', async () => {
      const { service, mockGenerate } = makeService('key');
      mockGenerate.mockResolvedValue({
        text: '["Artist official video","Artist best songs"]',
      });

      const queries = await service.generateSearchQueries('Artist');

      expect(Array.isArray(queries)).toBe(true);
      expect(queries.length).toBeGreaterThan(0);
      queries.forEach(q => expect(typeof q).toBe('string'));
    });

    it('returns default queries containing artist name when no API key', async () => {
      const { service } = makeService(); // no key
      const queries = await service.generateSearchQueries('Coldplay', ['Yellow']);

      expect(queries.some(q => q.toLowerCase().includes('coldplay'))).toBe(true);
    });

    it('returns default queries when model throws', async () => {
      const { service, mockGenerate } = makeService('key');
      mockGenerate.mockRejectedValue(new Error('fail'));

      const queries = await service.generateSearchQueries('Adele');

      expect(queries.some(q => q.toLowerCase().includes('adele'))).toBe(true);
    });
  });

  // ── cleanAndDeduplicate ─────────────────────────────────────────────────────

  describe('cleanAndDeduplicate', () => {
    it('returns [] immediately without calling model when input is empty', async () => {
      const { service, mockGenerate } = makeService('key');

      const result = await service.cleanAndDeduplicate([]);

      expect(result).toEqual([]);
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('falls back to basicClean when model is unavailable (no API key)', async () => {
      const { service } = makeService(); // no key
      const raw = [
        { videoId: 'v1', title: 'Song (Official Video)', channelTitle: 'Artist', artistName: 'Artist', genre: 'Pop', artistRank: 1, thumbnailUrl: '', durationSeconds: 200 },
        { videoId: 'v2', title: 'Song (Lyrics)', channelTitle: 'Artist', artistName: 'Artist', genre: 'Pop', artistRank: 1, thumbnailUrl: '', durationSeconds: 200 },
      ];

      const result = await service.cleanAndDeduplicate(raw);

      // basicClean deduplicates same normalized title+artist
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Song');
    });

    it('falls back to basicClean when model throws', async () => {
      const { service, mockGenerate } = makeService('key');
      mockGenerate.mockRejectedValue(new Error('fail'));
      const raw = [
        { videoId: 'v1', title: 'Track A', channelTitle: 'X', artistName: 'X', genre: 'Rock', artistRank: 1, thumbnailUrl: '', durationSeconds: 180 },
      ];

      const result = await service.cleanAndDeduplicate(raw);

      expect(result).toHaveLength(1);
      expect(result[0].youtubeId).toBe('v1');
    });
  });

  // ── rankAndDisambiguate ─────────────────────────────────────────────────────

  describe('rankAndDisambiguate', () => {
    const ctx = { title: 'Song', artistName: 'Artist', genre: 'Pop' };

    it('returns videoId directly without calling model when only one result', async () => {
      const { service, mockGenerate } = makeService('key');
      const results = [{ videoId: 'abc', title: 'Song', channelTitle: 'Artist', duration: 200 }];

      const id = await service.rankAndDisambiguate(results, ctx);

      expect(id).toBe('abc');
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('returns first result videoId when model returns unknown videoId', async () => {
      const { service, mockGenerate } = makeService('key');
      mockGenerate.mockResolvedValue({ text: 'unknown_id' });
      const results = [
        { videoId: 'first', title: 'Song', channelTitle: 'Artist', duration: 200 },
        { videoId: 'second', title: 'Song Alt', channelTitle: 'Artist', duration: 210 },
      ];

      const id = await service.rankAndDisambiguate(results, ctx);

      expect(id).toBe('first');
    });

    it('returns matched videoId when model returns a valid one', async () => {
      const { service, mockGenerate } = makeService('key');
      mockGenerate.mockResolvedValue({ text: 'second' });
      const results = [
        { videoId: 'first', title: 'Song', channelTitle: 'Artist', duration: 200 },
        { videoId: 'second', title: 'Song Official', channelTitle: 'Artist', duration: 210 },
      ];

      const id = await service.rankAndDisambiguate(results, ctx);

      expect(id).toBe('second');
    });

    it('returns empty string when results array is empty', async () => {
      const { service } = makeService('key');
      const id = await service.rankAndDisambiguate([], ctx);
      expect(id).toBe('');
    });
  });
});
