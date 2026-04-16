import { Module } from '@nestjs/common';
import { FirebaseAdminService } from './firebase-admin.service';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import { AdminController } from './admin.controller';

@Module({
  providers: [FirebaseAdminService, FirebaseAuthGuard],
  controllers: [AdminController],
  exports: [FirebaseAdminService, FirebaseAuthGuard],
})
export class AuthModule {}
