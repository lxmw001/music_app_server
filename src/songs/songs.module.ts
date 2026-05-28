import { Module } from '@nestjs/common';
import { FirestoreModule } from '../firestore/firestore.module';
import { AuthModule } from '../auth/auth.module';
import { SyncModule } from '../sync/sync.module';
import { SongsService } from './songs.service';
import { SongsController } from './songs.controller';
import { SearchRefreshScheduler } from './search-refresh.scheduler';
import { SongDeduplicationService } from './song-deduplication.service';
import { MetadataBackfillScheduler } from './metadata-backfill.scheduler';
import { TrendingRefreshScheduler } from './trending-refresh.scheduler';
import { CountrySearchScheduler } from './country-search.scheduler';
import { CountrySearchController } from './country-search.controller';

@Module({
  imports: [FirestoreModule, AuthModule, SyncModule],
  controllers: [SongsController, CountrySearchController],
  providers: [SongsService, SearchRefreshScheduler, SongDeduplicationService, MetadataBackfillScheduler, TrendingRefreshScheduler, CountrySearchScheduler],
  exports: [SongsService, SongDeduplicationService],
})
export class SongsModule {}
