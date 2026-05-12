import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { AuthModule } from '../auth/auth.module';
import { FirestoreModule } from '../firestore/firestore.module';
import { VibeController } from './vibe.controller';
import { VibeService } from './vibe.service';

@Module({
  imports: [SyncModule, AuthModule, FirestoreModule],
  controllers: [VibeController],
  providers: [VibeService],
})
export class VibeModule {}
