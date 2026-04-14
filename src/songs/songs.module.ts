import { Module } from '@nestjs/common';
import { FirestoreModule } from '../firestore/firestore.module';
import { AuthModule } from '../auth/auth.module';
import { SongsService } from './songs.service';
import { SongsController } from './songs.controller';

@Module({
  imports: [FirestoreModule, AuthModule],
  controllers: [SongsController],
  providers: [SongsService],
  exports: [SongsService],
})
export class SongsModule {}
