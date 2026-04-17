import { Module } from '@nestjs/common';
import { FirestoreModule } from '../firestore/firestore.module';
import { AuthModule } from '../auth/auth.module';
import { SyncModule } from '../sync/sync.module';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';

@Module({
  imports: [FirestoreModule, AuthModule, SyncModule],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
