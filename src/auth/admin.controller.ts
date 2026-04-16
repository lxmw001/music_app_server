import { Controller, Post, Param } from '@nestjs/common';
import { FirebaseAdminService } from '../auth/firebase-admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly firebaseAdmin: FirebaseAdminService) {}

  @Post('set-admin/:uid')
  async setAdmin(@Param('uid') uid: string): Promise<{ message: string }> {
    await this.firebaseAdmin.auth().setCustomUserClaims(uid, { admin: true });
    return { message: `Admin claim set for user ${uid}` };
  }
}
