import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { SyncService } from './sync.service';
import { AdminGuard } from './admin.guard';

@Controller('sync')
@UseGuards(AdminGuard)
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('start')
  async startSync(@Body() body: { genres?: string[]; country?: string }) {
    return this.syncService.startSync(body.genres, body.country);
  }

  @Get('progress/:syncId')
  async getProgress(@Param('syncId') syncId: string) {
    const progress = await this.syncService.getProgress(syncId);
    if (!progress) {
      return { error: 'Sync not found' };
    }
    return progress;
  }

  @Post('resume/:syncId')
  async resumeSync(@Param('syncId') syncId: string) {
    return this.syncService.resumeSync(syncId);
  }

  @Post('incremental/:genre')
  async incrementalSync(
    @Param('genre') genre: string,
    @Body() body: { country?: string }
  ) {
    return this.syncService.incrementalSync(genre, body.country);
  }
}
