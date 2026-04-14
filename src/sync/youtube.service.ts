import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { YouTubeSearchResult } from './interfaces/sync.interfaces';

const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const YOUTUBE_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';

@Injectable()
export class YouTubeService {
  private readonly logger = new Logger(YouTubeService.name);

  async search(query: string): Promise<YouTubeSearchResult[]> {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      this.logger.warn('YOUTUBE_API_KEY not set — skipping YouTube search');
      return [];
    }

    try {
      const searchResponse = await axios.get(YOUTUBE_SEARCH_URL, {
        params: {
          key: apiKey,
          q: query,
          part: 'snippet',
          type: 'video',
          videoCategoryId: '10', // Music category
          maxResults: 10,
        },
      });

      const items: any[] = searchResponse.data.items ?? [];
      if (items.length === 0) return [];

      const videoIds = items.map((item: any) => item.id.videoId).join(',');

      // Fetch durations via videos.list
      let durationsMap: Record<string, number> = {};
      try {
        const videosResponse = await axios.get(YOUTUBE_VIDEOS_URL, {
          params: {
            key: apiKey,
            id: videoIds,
            part: 'contentDetails',
          },
        });
        for (const v of videosResponse.data.items ?? []) {
          durationsMap[v.id] = this.parseDuration(v.contentDetails?.duration ?? '');
        }
      } catch {
        // Duration fetch is best-effort
      }

      return items.map((item: any) => ({
        videoId: item.id.videoId as string,
        title: item.snippet.title as string,
        channelTitle: item.snippet.channelTitle as string,
        durationSeconds: durationsMap[item.id.videoId],
      }));
    } catch (error) {
      this.logger.warn(`YouTube search failed for query "${query}": ${(error as Error).message}`);
      return [];
    }
  }

  private parseDuration(iso8601: string): number {
    const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    const hours = parseInt(match[1] ?? '0', 10);
    const minutes = parseInt(match[2] ?? '0', 10);
    const seconds = parseInt(match[3] ?? '0', 10);
    return hours * 3600 + minutes * 60 + seconds;
  }
}
