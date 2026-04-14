import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './shared/test-app.factory';
import { makeSongDoc } from './shared/mock-factories';

const AUTH_USER = JSON.stringify({ uid: 'user-1', email: 'user@test.com', admin: false });

describe('Songs (e2e)', () => {
  let app: INestApplication;
  let mocks: Record<string, any>;

  beforeAll(async () => {
    ({ app, mocks } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mocks.firestore._docRef.get.mockReset();
    mocks.firestore._collectionRef.get.mockReset();
    mocks.cache.get.mockResolvedValue(null);
    mocks.cache.set.mockResolvedValue(undefined);
  });

  describe('GET /songs/:id', () => {
    it('200 with full DTO when song exists', async () => {
      mocks.firestore._docRef.get.mockResolvedValue(makeSongDoc());

      const res = await request(app.getHttpServer())
        .get('/songs/song-1')
        .set('x-test-user', AUTH_USER);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: 'song-1',
        title: 'Test Song',
        artistId: 'artist-1',
        durationSeconds: 180,
        youtubeId: 'yt-abc',
        genre: 'Rock',
      });
    });

    it('404 with error shape when song not found', async () => {
      mocks.firestore._docRef.get.mockResolvedValue({ exists: false });

      const res = await request(app.getHttpServer())
        .get('/songs/nonexistent')
        .set('x-test-user', AUTH_USER);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        statusCode: 404,
        message: expect.any(String),
        timestamp: expect.any(String),
      });
    });

    it('401 when no auth header', async () => {
      const res = await request(app.getHttpServer()).get('/songs/song-1');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /songs', () => {
    it('200 with array body when page and pageSize provided', async () => {
      mocks.firestore._collectionRef.get.mockResolvedValue({ docs: [], empty: true, size: 0 });

      const res = await request(app.getHttpServer())
        .get('/songs?page=1&pageSize=5')
        .set('x-test-user', AUTH_USER);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('200 with defaults when no pagination params', async () => {
      mocks.firestore._collectionRef.get.mockResolvedValue({ docs: [], empty: true, size: 0 });

      const res = await request(app.getHttpServer())
        .get('/songs')
        .set('x-test-user', AUTH_USER);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
