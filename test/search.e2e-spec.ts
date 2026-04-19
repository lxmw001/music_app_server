import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './shared/test-app.factory';

const AUTH_USER = JSON.stringify({ uid: 'user-1', email: 'user@test.com', admin: false });

const EMPTY_SNAPSHOT = { docs: [], empty: true, size: 0 };

describe('Search (e2e)', () => {
  let app: INestApplication;
  let mocks: Record<string, any>;

  beforeAll(async () => {
    ({ app, mocks } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mocks.firestore._collectionRef.get.mockResolvedValue(EMPTY_SNAPSHOT);
    mocks.cache.get.mockResolvedValue(null);
    mocks.cache.set.mockResolvedValue(undefined);
  });

  describe('GET /search?q=rock', () => {
    it('200 with body containing exactly keys songs, artists, albums, playlists', async () => {
      const res = await request(app.getHttpServer())
        .get('/search?q=rock')
        .set('x-test-user', AUTH_USER);

      expect(res.status).toBe(200);
      const keys = Object.keys(res.body).sort();
      expect(keys).toEqual(['albums', 'artists', 'playlists', 'songs']);
      expect(Array.isArray(res.body.songs)).toBe(true);
      expect(Array.isArray(res.body.artists)).toBe(true);
      expect(Array.isArray(res.body.albums)).toBe(true);
      expect(Array.isArray(res.body.playlists)).toBe(true);
    });
  });

  describe('GET /search?q=', () => {
    it('400 when q is empty string', async () => {
      const res = await request(app.getHttpServer())
        .get('/search?q=')
        .set('x-test-user', AUTH_USER);

      expect(res.status).toBe(400);
    });
  });

  describe('GET /search (no q param)', () => {
    it('400 when q param is missing', async () => {
      const res = await request(app.getHttpServer())
        .get('/search')
        .set('x-test-user', AUTH_USER);

      expect(res.status).toBe(400);
    });
  });

  describe('GET /search?q=rock without auth', () => {
    it('200 (optional auth)', async () => {
      mocks.firestore._collectionRef.get.mockResolvedValue({ docs: [], empty: true, size: 0 });
      const res = await request(app.getHttpServer()).get('/search?q=rock');
      expect(res.status).toBe(200);
    });
  });
});
