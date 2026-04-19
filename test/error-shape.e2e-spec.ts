import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './shared/test-app.factory';

const AUTH_USER = JSON.stringify({ uid: 'user-1', email: 'user@test.com', admin: false });

function assertErrorShape(body: any) {
  expect(typeof body.statusCode).toBe('number');
  const messageIsString = typeof body.message === 'string';
  const messageIsArray = Array.isArray(body.message);
  expect(messageIsString || messageIsArray).toBe(true);
  expect(new Date(body.timestamp).toString()).not.toBe('Invalid Date');
}

describe('Error response shape (e2e)', () => {
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

  it('400 from validation — message is string[]', async () => {
    // POST /playlists with missing required "name" field triggers validation error
    const res = await request(app.getHttpServer())
      .post('/playlists')
      .set('x-test-user', AUTH_USER)
      .send({});

    expect(res.status).toBe(400);
    assertErrorShape(res.body);
    expect(Array.isArray(res.body.message)).toBe(true);
  });

  it('404 — standard error shape', async () => {
    mocks.firestore._docRef.get.mockResolvedValue({ exists: false });

    const res = await request(app.getHttpServer())
      .get('/songs/nonexistent')
      .set('x-test-user', AUTH_USER);

    expect(res.status).toBe(404);
    assertErrorShape(res.body);
    expect(res.body.statusCode).toBe(404);
  });

  it.skip('401 — standard error shape (OptionalAuthGuard allows no auth)', async () => {
    const res = await request(app.getHttpServer()).get('/songs/song-1');

    expect(res.status).toBe(401);
    assertErrorShape(res.body);
    expect(res.body.statusCode).toBe(401);
  });

  it('500 from unhandled exception — statusCode 500, message "Internal server error"', async () => {
    // Make the firestore doc().get() throw a plain Error (not HttpException)
    mocks.firestore._docRef.get.mockRejectedValue(new Error('Unexpected Firestore failure'));

    const res = await request(app.getHttpServer())
      .get('/songs/song-1')
      .set('x-test-user', AUTH_USER);

    expect(res.status).toBe(500);
    assertErrorShape(res.body);
    expect(res.body.statusCode).toBe(500);
    expect(res.body.message).toBe('Internal server error');
  });
});
