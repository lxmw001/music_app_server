import { Injectable, Logger } from '@nestjs/common';
import * as SpotifyWebApi from 'spotify-web-api-node';

export interface SpotifyTrackMetadata {
  spotifyId: string;
  album: string;
  albumArt: string;
  releaseDate: string;
  genres: string[];
  popularity: number;
}

@Injectable()
export class SpotifyService {
  private readonly logger = new Logger(SpotifyService.name);
  private readonly spotify: SpotifyWebApi | null;
  private tokenExpiresAt = 0;

  constructor() {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

    if (clientId && clientSecret) {
      this.spotify = new (SpotifyWebApi as any)({
        clientId,
        clientSecret,
      });
      this.logger.log('Spotify API initialized');
    } else {
      this.logger.warn('Spotify credentials not set - metadata enrichment disabled');
      this.spotify = null;
    }
  }

  async searchTrack(title: string, artist: string): Promise<SpotifyTrackMetadata | null> {
    if (!this.spotify) return null;

    try {
      await this.ensureToken();

      const query = `track:${title} artist:${artist}`;
      const result = await this.spotify.searchTracks(query, { limit: 1 });

      if (result.body.tracks?.items.length === 0) {
        return null;
      }

      const track = result.body.tracks.items[0];
      const album = track.album;

      // Get artist genres (tracks don't have genres, but artists do)
      let genres: string[] = [];
      if (track.artists[0]?.id) {
        try {
          const artistData = await this.spotify.getArtist(track.artists[0].id);
          genres = artistData.body.genres || [];
        } catch {
          // Ignore artist fetch errors
        }
      }

      return {
        spotifyId: track.id,
        album: album.name,
        albumArt: album.images[0]?.url || '',
        releaseDate: album.release_date,
        genres,
        popularity: track.popularity,
      };
    } catch (error) {
      // Silently fail - Spotify enrichment is optional
      // Common causes: Development Mode restrictions, rate limits, network issues
      if (error?.statusCode === 403) {
        this.logger.debug(`Spotify in Development Mode - skipping enrichment for "${title}"`);
      } else {
        const errorDetails = {
          statusCode: error?.statusCode,
          body: error?.body,
        };
        this.logger.warn(`Spotify search failed for "${title}" by ${artist}:`, errorDetails);
      }
      return null;
    }
  }

  private async ensureToken(): Promise<void> {
    if (Date.now() < this.tokenExpiresAt) {
      return; // Token still valid
    }

    try {
      const data = await this.spotify.clientCredentialsGrant();
      this.spotify.setAccessToken(data.body.access_token);
      this.tokenExpiresAt = Date.now() + data.body.expires_in * 1000 - 60000; // Refresh 1 min early
      this.logger.log('Spotify access token refreshed');
    } catch (error) {
      this.logger.error('Failed to get Spotify token - enrichment disabled');
      throw error;
    }
  }
}
