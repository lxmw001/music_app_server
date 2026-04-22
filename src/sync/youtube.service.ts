import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { YouTubeSearchResult } from './interfaces/sync.interfaces';

const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const YOUTUBE_VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';

@Injectable()
export class YouTubeService {
  private readonly logger = new Logger(YouTubeService.name);
  private readonly apiKeys: string[];
  private currentKeyIndex = 0;

  constructor() {
    const keys = [
      process.env.YOUTUBE_API_KEY,
      process.env.YOUTUBE_API_KEY_2,
      process.env.YOUTUBE_API_KEY_3,
    ].filter(key => key && key.length > 0);

    if (keys.length === 0) {
      this.logger.warn('No YouTube API keys configured');
      this.apiKeys = [];
    } else {
      this.apiKeys = keys;
      this.logger.log(`Initialized with ${keys.length} YouTube API key(s)`);
    }
  }

  private getCurrentApiKey(): string {
    if (this.apiKeys.length === 0) {
      throw new Error('No YouTube API keys available');
    }
    return this.apiKeys[this.currentKeyIndex];
  }

  private rotateApiKey(): boolean {
    if (this.apiKeys.length <= 1) return false;
    this.currentKeyIndex = (this.currentKeyIndex + 1) % this.apiKeys.length;
    this.logger.log(`Rotated to API key ${this.currentKeyIndex + 1}/${this.apiKeys.length}`);
    return true;
  }

  async searchVideos(query: string, maxResults: number = 10): Promise<YouTubeSearchResult[]> {
    let lastError: any;
    
    // Try all available API keys
    for (let attempt = 0; attempt < this.apiKeys.length; attempt++) {
      try {
        return await this.searchWithCurrentKey(query, maxResults);
      } catch (error) {
        lastError = error;
        
        if (this.isQuotaError(error)) {
          this.logger.warn(`API key ${this.currentKeyIndex + 1} quota exceeded`);
          if (!this.rotateApiKey()) {
            // No more keys to try
            throw error;
          }
          // Try next key
          continue;
        }
        
        // Non-quota error, don't retry
        throw error;
      }
    }
    
    // All keys exhausted
    throw lastError;
  }

  private async searchWithCurrentKey(query: string, maxResults: number): Promise<YouTubeSearchResult[]> {
    const apiKey = this.getCurrentApiKey();

    const searchResponse = await axios.get(YOUTUBE_SEARCH_URL, {
      params: {
        key: apiKey,
        q: query,
        part: 'snippet',
        type: 'video',
        videoCategoryId: '10',
        maxResults,
      },
    });

    const items: any[] = searchResponse.data.items ?? [];
    if (items.length === 0) return [];

    const videoIds = items.map((item: any) => item.id.videoId).join(',');

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
      thumbnailUrl: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
      durationSeconds: durationsMap[item.id.videoId],
    }));
  }

  private isQuotaError(error: any): boolean {
    return error?.response?.data?.error?.errors?.[0]?.reason === 'quotaExceeded';
  }

  private parseDuration(iso8601: string): number {
    const match = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    const hours = parseInt(match[1] ?? '0', 10);
    const minutes = parseInt(match[2] ?? '0', 10);
    const seconds = parseInt(match[3] ?? '0', 10);
    return hours * 3600 + minutes * 60 + seconds;
  }

  async getTrendingVideos(regionCode: string = 'US', maxResults: number = 50): Promise<YouTubeSearchResult[]> {
    let lastError: any;
    
    // Try all available API keys
    for (let attempt = 0; attempt < this.apiKeys.length; attempt++) {
      try {
        return await this.getTrendingWithCurrentKey(regionCode, maxResults);
      } catch (error) {
        lastError = error;
        
        if (this.isQuotaError(error)) {
          this.logger.warn(`API key ${this.currentKeyIndex + 1} quota exceeded`);
          if (!this.rotateApiKey()) {
            throw error;
          }
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError;
  }

  private async getTrendingWithCurrentKey(regionCode: string, maxResults: number): Promise<YouTubeSearchResult[]> {
    const apiKey = this.getCurrentApiKey();

    // Get trending videos (music category = 10)
    const response = await axios.get(YOUTUBE_VIDEOS_URL, {
      params: {
        key: apiKey,
        part: 'snippet,contentDetails',
        chart: 'mostPopular',
        regionCode,
        videoCategoryId: '10', // Music category
        maxResults,
      },
    });

    const items: any[] = response.data.items ?? [];

    return items.map((item: any) => ({
      videoId: item.id as string,
      title: item.snippet.title as string,
      channelTitle: item.snippet.channelTitle as string,
      thumbnailUrl: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
      durationSeconds: this.parseDuration(item.contentDetails?.duration ?? ''),
    }));
  }

  async getRelatedVideos(artistName: string, maxResults: number = 30): Promise<YouTubeSearchResult[]> {
    let lastError: any;

    for (let attempt = 0; attempt < this.apiKeys.length; attempt++) {
      try {
        this.logger.log(`Getting best songs for artist: ${artistName}`);
        return await this.searchWithCurrentKey(`${artistName} best songs`, maxResults);
      } catch (error) {
        lastError = error;
        if (this.isQuotaError(error)) {
          this.logger.warn(`API key ${this.currentKeyIndex + 1} quota exceeded`);
          if (!this.rotateApiKey()) throw error;
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }
}
