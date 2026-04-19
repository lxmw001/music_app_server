import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export interface MusicMetadata {
  album: string;
  albumArt: string;
  releaseDate: string;
  tags: string[];
  listeners: number;
  mbid?: string; // MusicBrainz ID
}

@Injectable()
export class LastFmService {
  private readonly logger = new Logger(LastFmService.name);
  private readonly apiKey: string | null;
  private readonly baseUrl = 'https://ws.audioscrobbler.com/2.0/';

  constructor() {
    this.apiKey = process.env.LASTFM_API_KEY;

    if (this.apiKey) {
      this.logger.log('Last.fm API initialized');
    } else {
      this.logger.warn('LASTFM_API_KEY not set - metadata enrichment disabled');
    }
  }

  async searchTrack(title: string, artist: string): Promise<MusicMetadata | null> {
    if (!this.apiKey) {
      this.logger.warn('Last.fm API key not set - skipping enrichment');
      return null;
    }

    try {
      this.logger.log(`Searching Last.fm: "${title}" by ${artist}`);
      
      // Search for track
      const response = await axios.get(this.baseUrl, {
        params: {
          method: 'track.getInfo',
          api_key: this.apiKey,
          artist,
          track: title,
          format: 'json',
        },
      });

      console.log('Last.fm response:', JSON.stringify(response.data, null, 2));

      const track = response.data?.track;
      if (!track) {
        this.logger.debug(`No Last.fm data found for "${title}" by ${artist}`);
        return null;
      }

      // Extract album art (largest available)
      const albumArt = track.album?.image?.find((img: any) => img.size === 'extralarge')?.['#text'] || 
                       track.album?.image?.find((img: any) => img.size === 'large')?.['#text'] || '';

      // Extract tags/genres
      const tags = track.toptags?.tag?.slice(0, 5).map((t: any) => t.name) || [];

      const metadata = {
        album: track.album?.title || '',
        albumArt,
        releaseDate: '', // Last.fm doesn't provide release dates
        tags,
        listeners: parseInt(track.listeners) || 0,
        mbid: track.mbid || undefined,
      };

      this.logger.log(`Last.fm enrichment successful: ${tags.length} tags, ${metadata.listeners} listeners`);
      return metadata;
    } catch (error) {
      if (error?.response?.status === 404) {
        this.logger.debug(`Track not found on Last.fm: "${title}" by ${artist}`);
        return null;
      }
      
      const errorDetails = {
        status: error?.response?.status,
        statusText: error?.response?.statusText,
        data: error?.response?.data,
        message: error?.message,
      };
      
      console.error(`Last.fm API error for "${title}" by ${artist}:`, JSON.stringify(errorDetails, null, 2));
      this.logger.error(`Last.fm search failed for "${title}" by ${artist}: ${error.message}`);
      return null;
    }
  }

  async getSimilarTracks(title: string, artist: string, limit: number = 30): Promise<Array<{ title: string; artist: string }>> {
    if (!this.apiKey) {
      this.logger.warn('Last.fm API key not set - cannot get similar tracks');
      return [];
    }

    try {
      this.logger.log(`Getting similar tracks from Last.fm for "${title}" by ${artist}`);
      
      const response = await axios.get(this.baseUrl, {
        params: {
          method: 'track.getSimilar',
          api_key: this.apiKey,
          artist,
          track: title,
          limit,
          format: 'json',
        },
      });

      const similarTracks = response.data?.similartracks?.track || [];
      
      if (!Array.isArray(similarTracks)) {
        return [];
      }

      const results = similarTracks.map((track: any) => ({
        title: track.name,
        artist: track.artist?.name || '',
      }));

      this.logger.log(`Found ${results.length} similar tracks from Last.fm`);
      return results;
    } catch (error) {
      this.logger.warn(`Failed to get similar tracks: ${error.message}`);
      return [];
    }
  }
}
