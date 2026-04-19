import { Module } from '@nestjs/common';
import { FirestoreModule } from '../firestore/firestore.module';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SyncScheduler } from './sync.scheduler';
import { GeminiService } from './gemini.service';
import { YouTubeService } from './youtube.service';
import { SpotifyService } from './spotify.service';
import { AdminGuard } from './admin.guard';

@Module({
  imports: [FirestoreModule, AuthModule, StorageModule],
  controllers: [SyncController],
  providers: [SyncService, SyncScheduler, GeminiService, YouTubeService, SpotifyService, AdminGuard],
  exports: [GeminiService, YouTubeService, SpotifyService],
})
export class SyncModule {}
