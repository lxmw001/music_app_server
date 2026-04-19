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
      
      const snapshot = await this.firestore
        .collection('youtube_searches')
        .where('lastUpdated', '<', sevenDaysAgo)
        .limit(50) // Process 50 per day
        .get();

      this.logger.log(`Found ${snapshot.size} stale searches to refresh`);

      for (const doc of snapshot.docs) {
        const data = doc.data();
        try {
          this.logger.log(`Refreshing search: ${data.query}`);
          await this.songsService.searchYouTube({ query: data.query });
          await this.delay(5000); // Rate limit: 5 sec between searches
        } catch (error) {
          this.logger.error(`Failed to refresh "${data.query}": ${error.message}`);
        }
      }

      this.logger.log('Stale search refresh completed');
    } catch (error) {
      this.logger.error(`Search refresh failed: ${error.message}`);
    } finally {
      this.isRunning = false;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
