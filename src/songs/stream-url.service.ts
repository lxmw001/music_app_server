import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { FirestoreService } from '../firestore/firestore.service';

const execFileAsync = promisify(execFile);
const CACHE_COLLECTION = 'stream_url_cache';
const EXPIRY_BUFFER_SECONDS = 300;
const YT_DLP_BIN = process.env.YT_DLP_PATH || 'yt-dlp';

@Injectable()
export class StreamUrlService {
  private readonly logger = new Logger(StreamUrlService.name);

  constructor(private readonly firestore: FirestoreService) {}

  async getStreamUrl(songId: string): Promise<{ youtubeId: string; streamUrl: string; expiresAt: string }> {
    const songDoc = await this.firestore.doc(`songs/${songId}`).get();
    if (!songDoc.exists) throw new NotFoundException('Song not found');

    const youtubeId: string = songDoc.data()?.youtubeId;
    if (!youtubeId) throw new NotFoundException('Song has no YouTube ID');

    const cached = await this.getCached(youtubeId);
    if (cached) return cached;

    return this.fetchAndCache(youtubeId);
  }

  private async getCached(youtubeId: string): Promise<{ youtubeId: string; streamUrl: string; expiresAt: string } | null> {
    try {
      const doc = await this.firestore.doc(`${CACHE_COLLECTION}/${youtubeId}`).get();
      if (!doc.exists) return null;

      const data = doc.data()!;
      const expiresAt: Date = data.expiresAt.toDate();

      if (expiresAt.getTime() - Date.now() > EXPIRY_BUFFER_SECONDS * 1000) {
        return { youtubeId, streamUrl: data.streamUrl, expiresAt: expiresAt.toISOString() };
      }
    } catch (err) {
      this.logger.warn(`Cache read failed for ${youtubeId}: ${err.message}`);
    }
    return null;
  }

  private async fetchAndCache(youtubeId: string): Promise<{ youtubeId: string; streamUrl: string; expiresAt: string }> {
    this.logger.log(`Fetching stream URL for ${youtubeId}`);

    const { stdout } = await execFileAsync(YT_DLP_BIN, [
      '-f', 'bestaudio',
      '--get-url',
      '--no-playlist',
      `https://www.youtube.com/watch?v=${youtubeId}`,
    ]);

    const streamUrl = stdout.trim();
    if (!streamUrl) throw new Error(`yt-dlp returned no URL for ${youtubeId}`);

    const expiresAt = this.extractExpiry(streamUrl);

    await this.firestore.doc(`${CACHE_COLLECTION}/${youtubeId}`).set({
      streamUrl,
      expiresAt,
      cachedAt: new Date(),
    });

    return { youtubeId, streamUrl, expiresAt: expiresAt.toISOString() };
  }

  private extractExpiry(url: string): Date {
    const match = url.match(/[?&]expire=(\d+)/);
    if (match) return new Date(parseInt(match[1], 10) * 1000);
    return new Date(Date.now() + 6 * 60 * 60 * 1000);
  }
}
