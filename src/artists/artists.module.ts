import { Module } from '@nestjs/common';
import { FirestoreModule } from '../firestore/firestore.module';
import { AuthModule } from '../auth/auth.module';
import { ArtistsService } from './artists.service';
import { ArtistsController } from './artists.controller';

@Module({
  imports: [FirestoreModule, AuthModule],
  controllers: [ArtistsController],
  providers: [ArtistsService],
  exports: [ArtistsService],
})
export class ArtistsModule {}
