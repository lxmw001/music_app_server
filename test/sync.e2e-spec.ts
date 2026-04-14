import * as request from 'supertest';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { AppModule } from '../src/app.module';
import { FirebaseAuthGuard } from '../src/auth/firebase-auth.guard';
import { AdminGuard } from '../src/sync/admin.guard';
import { FirebaseAdminService } from '../src/auth/firebase-admin.service';
import { SyncService } from '../src/sync/sync.service';
import { FirestoreService } from '../src/firestore/firestore.service';
import { GeminiService } from '../src/sync/gemini.service';
import { YouTubeService } from '../src/sync/youtube.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import {
  createMockFirestore,
  createMockCache,
  createMockFirebaseAdmin,
  createMockGemini,
  createMockYouTube,
} from './shared/mock-factories';

const ADMIN_USER = JSON.stringify({ uid: 'admin-1', email: 'admin@test.com', admin: true });
const REGULAR_USER = JSON.stringify({ uid: 'user-1', email: 'user@test.com', admin: false });

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

describe('Sync (e2e)', () => {
  let app: INestApplication;
  const mockSyncService = {
    runSync: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FirebaseAdminService)
      .useValue(createMockFirebaseAdmin())
      .overrideProvider(FirestoreService)
      .useValue(createMockFirestore())
      .overrideProvider(CACHE_MANAGER)
      .useValue(createMockCache())
      .overrideProvider(GeminiService)
      .useValue(createMockGemini())
      .overrideProvider(YouTubeService)
      .useValue(createMockYouTube())
      .overrideProvider(SyncService)
      .useValue(mockSyncService)
      .overrideGuard(FirebaseAuthGuard)
      .useClass(MockFirebaseAuthGuard)
      .overrideGuard(AdminGuard)
      .useClass(MockAdminGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockSyncService.runSync.mockClear();
    mockSyncService.runSync.mockResolvedValue(undefined);
  });

  describe('POST /sync/trigger', () => {
    it('202 with { message: "Sync triggered" } for admin user', async () => {
      const res = await request(app.getHttpServer())
        .post('/sync/trigger')
        .set('x-test-user', ADMIN_USER)
        .send({});

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ message: 'Sync triggered' });
    });

    it('403 for non-admin user', async () => {
      const res = await request(app.getHttpServer())
        .post('/sync/trigger')
        .set('x-test-user', REGULAR_USER)
        .send({});

      expect(res.status).toBe(403);
    });

    it('401 without auth', async () => {
      const res = await request(app.getHttpServer())
        .post('/sync/trigger')
        .send({});

      expect(res.status).toBe(401);
    });

    it('calls runSync with { genres, force } when provided', async () => {
      await request(app.getHttpServer())
        .post('/sync/trigger')
        .set('x-test-user', ADMIN_USER)
        .send({ genres: ['Rock'], force: true });

      expect(mockSyncService.runSync).toHaveBeenCalledWith(
        expect.objectContaining({ genres: ['Rock'], force: true }),
      );
    });

    it('calls runSync when body is empty', async () => {
      await request(app.getHttpServer())
        .post('/sync/trigger')
        .set('x-test-user', ADMIN_USER)
        .send({});

      expect(mockSyncService.runSync).toHaveBeenCalled();
    });
  });
});
