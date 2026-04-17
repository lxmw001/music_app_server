import { YouTubeService } from './youtube.service';

jest.mock('axios');

import axios from 'axios';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('YouTubeService', () => {
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env.YOUTUBE_API_KEY;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.YOUTUBE_API_KEY = originalApiKey;
  });

  // ─── No API key ──────────────────────────────────────────────────────────────

  it('returns [] and makes no HTTP calls when no API key is set', async () => {
    process.env.YOUTUBE_API_KEY = '';
    const service = new YouTubeService();
    const result = await service.searchVideos('test query', 10);

    expect(result).toEqual([]);
    expect(mockedAxios.get).not.toHaveBeenCalled();
  });

  // ─── Search returns items ────────────────────────────────────────────────────

  it('makes a second HTTP call to videos endpoint for durations when search returns items', async () => {
    process.env.YOUTUBE_API_KEY = 'yt-key';
    const service = new YouTubeService();

    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          items: [
            { id: { videoId: 'vid-1' }, snippet: { title: 'Song 1', channelTitle: 'Artist 1' } },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [{ id: 'vid-1', contentDetails: { duration: 'PT3M30S' } }],
        },
      });

    const result = await service.searchVideos('test query', 10);

    expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(result[0].videoId).toBe('vid-1');
    expect(result[0].durationSeconds).toBe(210);
  });

  // ─── Videos endpoint throws ──────────────────────────────────────────────────

  it('still returns results when videos endpoint throws (best-effort duration fetch)', async () => {
    process.env.YOUTUBE_API_KEY = 'yt-key';
    const service = new YouTubeService();

    mockedAxios.get
      .mockResolvedValueOnce({
        data: {
          items: [
            { id: { videoId: 'vid-2' }, snippet: { title: 'Song 2', channelTitle: 'Artist 2' } },
          ],
        },
      })
      .mockRejectedValueOnce(new Error('videos endpoint error'));

    const result = await service.searchVideos('test query', 10);

    expect(result).toHaveLength(1);
    expect(result[0].videoId).toBe('vid-2');
    // No exception propagated
  });

  // ─── Search returns empty items ──────────────────────────────────────────────

  it('returns [] when search returns empty items array', async () => {
    process.env.YOUTUBE_API_KEY = 'yt-key';
    const service = new YouTubeService();

    mockedAxios.get.mockResolvedValueOnce({ data: { items: [] } });

    const result = await service.searchVideos('test query', 10);

    expect(result).toEqual([]);
    // No second call for durations
    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  // ─── Search API throws ───────────────────────────────────────────────────────

  it('returns [] and does not re-throw when search API throws', async () => {
    process.env.YOUTUBE_API_KEY = 'yt-key';
    const service = new YouTubeService();

    mockedAxios.get.mockRejectedValueOnce(new Error('network error'));

    const result = await service.searchVideos('test query', 10);

    expect(result).toEqual([]);
  });

  // ─── Duration parsing ────────────────────────────────────────────────────────

  describe('parseDuration (private)', () => {
    let service: YouTubeService;

    beforeEach(() => {
      process.env.YOUTUBE_API_KEY = 'yt-key';
      service = new YouTubeService();
    });

    it("parses 'PT1H2M3S' → 3723", () => {
      expect((service as any).parseDuration('PT1H2M3S')).toBe(3723);
    });

    it("parses 'PT30S' → 30", () => {
      expect((service as any).parseDuration('PT30S')).toBe(30);
    });

    it("parses '' → 0", () => {
      expect((service as any).parseDuration('')).toBe(0);
    });

    it("parses 'invalid' → 0", () => {
      expect((service as any).parseDuration('invalid')).toBe(0);
    });
  });
});
