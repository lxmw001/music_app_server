import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SongsService } from './songs.service';

@Injectable()
export class TrendingRefreshScheduler implements OnModuleInit {
  private readonly logger = new Logger(TrendingRefreshScheduler.name);

  constructor(private readonly songsService: SongsService) {}

  // Run on startup
  async onModuleInit() {
    this.logger.log('Running initial trending cache refresh on startup');
    await this.refreshTrendingCache();
  }

  // Run every hour
  @Cron(CronExpression.EVERY_HOUR)
  async refreshTrendingCache() {
    const countries = ['EC', 'MX', 'CO', 'US', 'AR', 'CL', 'PE', 'ES'];
    
    this.logger.log(`Starting scheduled trending refresh for ${countries.length} countries`);

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
