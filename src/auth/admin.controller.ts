import { Controller, Post, Param } from '@nestjs/common';
import { FirebaseAdminService } from '../auth/firebase-admin.service';
import { SongsService } from '../songs/songs.service';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly firebaseAdmin: FirebaseAdminService,
    private readonly songsService: SongsService,
  ) {}

  @Post('set-admin/:uid')
  async setAdmin(@Param('uid') uid: string): Promise<{ message: string }> {
    await this.firebaseAdmin.auth().setCustomUserClaims(uid, { admin: true });
    return { message: `Admin claim set for user ${uid}` };
  }

  /**
   * One-time migration: backfill videoTitle for all songs missing the field.
   * Fetches original YouTube titles in batches of 50.
   */
  @Post('backfill-video-titles')
  async backfillVideoTitles(): Promise<{ processed: number; skipped: number; failed: number }> {
    return this.songsService.backfillVideoTitles();
  }
}
