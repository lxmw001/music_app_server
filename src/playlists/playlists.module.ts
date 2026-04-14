import { Module } from '@nestjs/common';
import { FirestoreModule } from '../firestore/firestore.module';
import { AuthModule } from '../auth/auth.module';
import { PlaylistsService } from './playlists.service';
import { PlaylistsController } from './playlists.controller';

@Module({
  imports: [FirestoreModule, AuthModule],
  controllers: [PlaylistsController],
  providers: [PlaylistsService],
  exports: [PlaylistsService],
})
export class PlaylistsModule {}
