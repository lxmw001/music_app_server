import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SyncService } from './sync.service';

@Injectable()
export class SyncScheduler {
  private readonly logger = new Logger(SyncScheduler.name);

  constructor(private readonly syncService: SyncService) {}

  @Cron('0 2 * * *')
  async handleDailySync(): Promise<void> {
    this.logger.log('Daily sync cron triggered');
    try {
      await this.syncService.runSync({ genres: [], force: false });
    } catch (error) {
      this.logger.error(`Daily sync failed: ${(error as Error).message}`);
    }
  }
}
