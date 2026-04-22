import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { CacheModule } from './cache/cache.module';
import { SongsModule } from './songs/songs.module';
import { ArtistsModule } from './artists/artists.module';
import { AlbumsModule } from './albums/albums.module';
import { PlaylistsModule } from './playlists/playlists.module';
import { SearchModule } from './search/search.module';
import { SuggestionsModule } from './suggestions/suggestions.module';
import { SyncModule } from './sync/sync.module';
import { AuthModule } from './auth/auth.module';
import { AdminController } from './auth/admin.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    CacheModule,
    AuthModule,
    SongsModule,
    ArtistsModule,
    AlbumsModule,
    PlaylistsModule,
    SearchModule,
    SuggestionsModule,
    SyncModule,
  ],
  controllers: [AdminController],
  providers: [],
})
export class AppModule {}
