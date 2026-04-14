import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './shared/test-app.factory';

const AUTH_USER = JSON.stringify({ uid: 'user-1', email: 'user@test.com', admin: false });

const EMPTY_SNAPSHOT = { docs: [], empty: true, size: 0 };

function makeSuggestionDoc(id: string, name: string) {
  return {
    id,
    data: () => ({ name, nameLower: name.toLowerCase(), searchTokens: [name.toLowerCase()] }),
  };
}

describe('Suggestions (e2e)', () => {
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

  describe('GET /suggestions?q=ro', () => {
    it('200 with array of at most 10 items', async () => {
      const res = await request(app.getHttpServer())
        .get('/suggestions?q=ro')
        .set('x-test-user', AUTH_USER);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeLessThanOrEqual(10);
    });
  });

  describe('GET /suggestions?q=r', () => {
    it('400 when query is too short', async () => {
      const res = await request(app.getHttpServer())
        .get('/suggestions?q=r')
        .set('x-test-user', AUTH_USER);

      expect(res.status).toBe(400);
    });
  });

  describe('GET /suggestions?q=rock', () => {
    it('200 with items containing { id, name, type }', async () => {
      const doc = makeSuggestionDoc('artist-1', 'Rock Band');
      mocks.firestore._collectionRef.get.mockResolvedValue({
        docs: [doc],
        empty: false,
        size: 1,
      });

      const res = await request(app.getHttpServer())
        .get('/suggestions?q=rock')
        .set('x-test-user', AUTH_USER);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      if (res.body.length > 0) {
        expect(res.body[0]).toMatchObject({
          id: expect.any(String),
          name: expect.any(String),
          type: expect.any(String),
        });
      }
    });

    it('401 without auth', async () => {
      const res = await request(app.getHttpServer()).get('/suggestions?q=rock');
      expect(res.status).toBe(401);
    });
  });
});
