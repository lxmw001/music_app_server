import { Module } from '@nestjs/common';
import { FirestoreModule } from '../firestore/firestore.module';
import { AuthModule } from '../auth/auth.module';
import { SyncModule } from '../sync/sync.module';
import { SearchService } from './search.service';

@Module({
  imports: [FirestoreModule, AuthModule, SyncModule],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
