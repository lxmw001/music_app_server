import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AppModule } from '../../src/app.module';
import { FirebaseAuthGuard } from '../../src/auth/firebase-auth.guard';
import { AdminGuard } from '../../src/sync/admin.guard';
import { FirebaseAdminService } from '../../src/auth/firebase-admin.service';
import { FirestoreService } from '../../src/firestore/firestore.service';
import { GeminiService } from '../../src/sync/gemini.service';
import { YouTubeService } from '../../src/sync/youtube.service';
import { HttpExceptionFilter } from '../../src/common/filters/http-exception.filter';
import {
  createMockFirestore,
  createMockCache,
  createMockFirebaseAdmin,
  createMockGemini,
  createMockYouTube,
} from './mock-factories';

class MockFirebaseAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header = req.headers['x-test-user'];
    if (!header) throw new UnauthorizedException();
    req.user = JSON.parse(header);
    return true;
  }
}

class MockAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header = req.headers['x-test-user'];
    if (!header) throw new UnauthorizedException();
    req.user = JSON.parse(header);
    if (req.user?.admin !== true) {
      throw new ForbiddenException('Admin access required');
    }
    return true;
  }
}

export async function createTestApp(overrides?: {
  firestore?: object;
  cache?: object;
  gemini?: object;
  youtube?: object;
}): Promise<{ app: INestApplication; mocks: Record<string, any> }> {
  const mocks = {
    firestore: overrides?.firestore ?? createMockFirestore(),
    cache: overrides?.cache ?? createMockCache(),
    gemini: overrides?.gemini ?? createMockGemini(),
    youtube: overrides?.youtube ?? createMockYouTube(),
    firebaseAdmin: createMockFirebaseAdmin(),
  };

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(FirebaseAdminService)
    .useValue(mocks.firebaseAdmin)
    .overrideProvider(FirestoreService)
    .useValue(mocks.firestore)
    .overrideProvider(CACHE_MANAGER)
    .useValue(mocks.cache)
    .overrideProvider(GeminiService)
    .useValue(mocks.gemini)
    .overrideProvider(YouTubeService)
    .useValue(mocks.youtube)
    .overrideGuard(FirebaseAuthGuard)
    .useClass(MockFirebaseAuthGuard)
    .overrideGuard(AdminGuard)
    .useClass(MockAdminGuard)
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();

  return { app, mocks };
}
