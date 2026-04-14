import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FirebaseStorageService } from './firebase-storage.service';

@Module({
  imports: [AuthModule],
  providers: [FirebaseStorageService],
  exports: [FirebaseStorageService],
})
export class StorageModule {}
