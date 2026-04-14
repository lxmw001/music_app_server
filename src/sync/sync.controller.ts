import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { SyncService } from './sync.service';
import { SyncRequestDto } from './dto/sync-request.dto';

@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('trigger')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  trigger(@Body() dto: SyncRequestDto): { message: string } {
    // Fire-and-forget — do not await
    this.syncService.runSync(dto).catch((err: Error) => {
      // Errors are logged inside runSync; catch here to prevent unhandled rejection
      console.error('Sync pipeline error:', err.message);
    });
    return { message: 'Sync triggered' };
  }
}
