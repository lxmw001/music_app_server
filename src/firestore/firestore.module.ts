import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FirestoreService } from './firestore.service';

@Module({
  imports: [AuthModule],
  providers: [FirestoreService],
  exports: [FirestoreService],
})
export class FirestoreModule {}
