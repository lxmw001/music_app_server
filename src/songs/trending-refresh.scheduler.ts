import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SongsService } from './songs.service';
import { FirestoreService } from '../firestore/firestore.service';

@Injectable()
export class TrendingRefreshScheduler implements OnModuleInit {
  private readonly logger = new Logger(TrendingRefreshScheduler.name);

  constructor(
    private readonly songsService: SongsService,
    private readonly firestore: FirestoreService,
  ) {}

  // Run on startup
  async onModuleInit() {
    this.logger.log('Running initial trending cache refresh on startup');
    await this.refreshTrendingCache();
  }

  // Run every hour
  @Cron(CronExpression.EVERY_HOUR)
  async refreshTrendingCache() {
    // Get list of countries from Firestore
    const countriesSnapshot = await this.firestore.collection('trending_countries').get();
    
    if (countriesSnapshot.empty) {
      this.logger.warn('No trending countries found in Firestore - skipping refresh');
      return;
    }

    const countries = countriesSnapshot.docs.map(doc => doc.id);
    
    this.logger.log(`Starting scheduled trending refresh for ${countries.length} countries: ${countries.join(', ')}`);

    for (const country of countries) {
      try {
        await this.songsService.getTrendingMusic(country, 50, true); // force refresh
        this.logger.log(`✓ Refreshed trending cache for ${country}`);
      } catch (error) {
        this.logger.error(`✗ Failed to refresh trending for ${country}: ${error.message}`);
      }
    }

    this.logger.log('Completed scheduled trending refresh');
  }
}
