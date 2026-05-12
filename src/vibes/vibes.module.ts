import { Module } from '@nestjs/common';
import { FirestoreModule } from '../firestore/firestore.module';
import { AuthModule } from '../auth/auth.module';
import { VibesController } from './vibes.controller';
import { VibesService } from './vibes.service';

@Module({
  imports: [FirestoreModule, AuthModule],
  controllers: [VibesController],
  providers: [VibesService],
})
export class VibesModule {}
