import { Module } from '@nestjs/common';
import { FirebaseAdminService } from './firebase-admin.service';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import { PermissionsGuard } from './permissions.guard';

@Module({
  providers: [FirebaseAdminService, FirebaseAuthGuard, PermissionsGuard],
  exports: [FirebaseAdminService, FirebaseAuthGuard, PermissionsGuard],
})
export class AuthModule {}
