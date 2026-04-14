import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './shared/test-app.factory';
import { makeArtistDoc } from './shared/mock-factories';

const AUTH_USER = JSON.stringify({ uid: 'user-1', email: 'user@test.com', admin: false });

describe('Artists (e2e)', () => {
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

  describe('GET /artists/:id', () => {
    it('200 with { id, name, biography, profileImageUrl }', async () => {
      mocks.firestore._docRef.get.mockResolvedValue(makeArtistDoc());

      const res = await request(app.getHttpServer())
        .get('/artists/artist-1')
        .set('x-test-user', AUTH_USER);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: 'artist-1',
        name: 'Test Artist',
        biography: 'A test artist biography.',
        profileImageUrl: null,
      });
    });

    it('404 when artist not found', async () => {
      mocks.firestore._docRef.get.mockResolvedValue({ exists: false });

      const res = await request(app.getHttpServer())
        .get('/artists/nonexistent')
        .set('x-test-user', AUTH_USER);

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        statusCode: 404,
        message: expect.any(String),
        timestamp: expect.any(String),
      });
    });

    it('401 without auth', async () => {
      const res = await request(app.getHttpServer()).get('/artists/artist-1');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /artists/:id/songs', () => {
    it('200 array', async () => {
      mocks.firestore._collectionRef.get.mockResolvedValue({ docs: [], empty: true, size: 0 });

      const res = await request(app.getHttpServer())
        .get('/artists/artist-1/songs')
        .set('x-test-user', AUTH_USER);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('GET /artists/:id/albums', () => {
    it('200 array', async () => {
      mocks.firestore._collectionRef.get.mockResolvedValue({ docs: [], empty: true, size: 0 });

      const res = await request(app.getHttpServer())
        .get('/artists/artist-1/albums')
        .set('x-test-user', AUTH_USER);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
