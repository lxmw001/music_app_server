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
      
      // To prioritize popular searches, we fetch the top 200 searches by searchCount 
      // and filter for staleness in memory. This avoids complex composite indexes
      // and Firestore's range filter limitations.
      const popularSearches = await this.firestore
        .collection('youtube_searches')
        .orderBy('searchCount', 'desc')
        .limit(200)
        .get();

      const staleSearches = popularSearches.docs.filter(doc => {
        const data = doc.data();
        const lastUpdated = data.lastUpdated?.toDate();
        return !lastUpdated || lastUpdated < sevenDaysAgo;
      }).slice(0, 50);

      this.logger.log(`Found ${staleSearches.length} popular stale searches to refresh`);

      for (const doc of staleSearches) {
        const data = doc.data();
        try {
          this.logger.log(`Refreshing search: "${data.query}" (searched ${data.searchCount || 0} times)`);
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
