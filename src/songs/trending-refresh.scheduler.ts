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
    const countriesSnapshot = await this.firestore.collection('trending_countries').get();
    if (countriesSnapshot.empty) return;

    const countries = countriesSnapshot.docs.map(doc => doc.id);
    const now = Date.now();
    const staleCountries: string[] = [];

    for (const country of countries) {
      const cached = await this.firestore.doc(`trending_cache_v2/${country}`).get();
      if (!cached.exists) {
        staleCountries.push(country);
        continue;
      }
      const lastUpdated = cached.data()?.lastUpdated?.toDate();
      if (!lastUpdated || now - lastUpdated.getTime() > 60 * 60 * 1000) {
        staleCountries.push(country);
      }
    }

    if (staleCountries.length === 0) {
      this.logger.log('Trending cache is fresh — skipping startup refresh');
      return;
    }

    this.logger.log(`Running startup trending refresh for stale countries: ${staleCountries.join(', ')}`);
    for (const country of staleCountries) {
      try {
        await this.songsService.getTrendingMusic(country, 50, true);
        this.logger.log(`✓ Refreshed trending cache for ${country}`);
      } catch (error) {
        this.logger.error(`✗ Failed to refresh trending for ${country}: ${error.message}`);
      }
    }
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
