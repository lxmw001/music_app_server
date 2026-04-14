import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { Global, Module } from '@nestjs/common';

@Global()
@Module({
  imports: [
    NestCacheModule.register({
      store: 'memory',
      max: 1000,
    }),
  ],
  exports: [NestCacheModule],
})
export class CacheModule {}
