import { Controller, Post, Delete, Param, Body } from '@nestjs/common';
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

  @Post('users/:uid/permissions')
  async grantPermission(
    @Param('uid') uid: string,
    @Body('permission') permission: string,
  ): Promise<{ uid: string; permissions: string[] }> {
    const user = await this.firebaseAdmin.auth().getUser(uid);
    const current: string[] = (user.customClaims as any)?.permissions ?? [];
    if (!current.includes(permission)) {
      const updated = [...current, permission];
      const existingClaims = (user.customClaims as any) ?? {};
      await this.firebaseAdmin.auth().setCustomUserClaims(uid, {
        ...existingClaims,
        permissions: updated,
      });
      return { uid, permissions: updated };
    }
    return { uid, permissions: current };
  }

  @Delete('users/:uid/permissions/:permission')
  async revokePermission(
    @Param('uid') uid: string,
    @Param('permission') permission: string,
  ): Promise<{ uid: string; permissions: string[] }> {
    const user = await this.firebaseAdmin.auth().getUser(uid);
    const current: string[] = (user.customClaims as any)?.permissions ?? [];
    const updated = current.filter(p => p !== permission);
    const existingClaims = (user.customClaims as any) ?? {};
    await this.firebaseAdmin.auth().setCustomUserClaims(uid, {
      ...existingClaims,
      permissions: updated,
    });
    return { uid, permissions: updated };
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
