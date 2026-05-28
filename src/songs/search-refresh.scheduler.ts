import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FirestoreService } from '../firestore/firestore.service';
import { SongsService } from '../songs/songs.service';

@Injectable()
export class SearchRefreshScheduler {
  private readonly logger = new Logger(SearchRefreshScheduler.name);
  private isRunning = false;

  constructor(
    private readonly firestore: FirestoreService,
    private readonly songsService: SongsService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async refreshStaleSearches() {
    if (this.isRunning) {
      this.logger.warn('Search refresh already running, skipping');
      return;
    }

    this.isRunning = true;
    this.logger.log('Starting stale search refresh');

    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const popularSearches = await this.firestore
        .collection('youtube_searches')
        .orderBy('searchCount', 'desc')
        .limit(200)
        .get();

      const staleSearches = popularSearches.docs.filter(doc => {
        const data = doc.data();
        if (this.isEmptySearch(data)) return false;
        const lastUpdated = data.lastUpdated?.toDate();
        return !lastUpdated || lastUpdated < sevenDaysAgo;
      }).slice(0, 50);

      this.logger.log(`Found ${staleSearches.length} popular stale searches to refresh`);

      for (const doc of staleSearches) {
        const data = doc.data();
        try {
          this.logger.log(`Refreshing search: "${data.query}" (searched ${data.searchCount || 0} times)`);
          await this.songsService.searchYouTube({ query: data.query, force: true });
          await this.delay(5000);
        } catch (error) {
          this.logger.error(`Failed to refresh "${data.query}": ${error.message}`);
        }
      }

      // Phase 2: find empty searches and re-run them
      await this.refreshEmptySearches();

      this.logger.log('Stale search refresh completed');
    } catch (error) {
      this.logger.error(`Search refresh failed: ${error.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  private async refreshEmptySearches(): Promise<void> {
    const snapshot = await this.firestore
      .collection('youtube_searches')
      .orderBy('searchCount', 'desc')
      .limit(200)
      .get();

    const emptySearches = snapshot.docs.filter(doc => this.isEmptySearch(doc.data())).slice(0, 30);

    if (emptySearches.length === 0) {
      this.logger.log('No empty searches found');
      return;
    }

    this.logger.log(`Found ${emptySearches.length} empty searches to re-run`);

    for (const doc of emptySearches) {
      const data = doc.data();
      try {
        this.logger.log(`Re-running empty search: "${data.query}"`);
        await this.songsService.searchYouTube({ query: data.query, force: true });
        await this.delay(5000);
      } catch (error) {
        this.logger.error(`Failed to re-run "${data.query}": ${error.message}`);
      }
    }
  }

  private isEmptySearch(data: any): boolean {
    const songs = data.songs;
    const mixes = data.mixes;
    const videos = data.videos;
    return (!songs || songs.length === 0) &&
           (!mixes || mixes.length === 0) &&
           (!videos || videos.length === 0);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
