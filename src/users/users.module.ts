import { Module } from '@nestjs/common';
import { FirestoreModule } from '../firestore/firestore.module';
import { AuthModule } from '../auth/auth.module';
import { PlaylistsModule } from '../playlists/playlists.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [FirestoreModule, AuthModule, PlaylistsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
