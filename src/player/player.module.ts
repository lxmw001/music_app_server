import { Module } from '@nestjs/common';
import { PlayerPageController } from './player-page.controller';

@Module({
  controllers: [PlayerPageController],
})
export class PlayerModule {}
