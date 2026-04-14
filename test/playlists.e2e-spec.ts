import * as request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createTestApp } from './shared/test-app.factory';
import { makePlaylistDoc, makeSongDoc } from './shared/mock-factories';

const AUTH_USER = JSON.stringify({ uid: 'user-1', email: 'user@test.com', admin: false });
const OTHER_USER = JSON.stringify({ uid: 'user-2', email: 'other@test.com', admin: false });

describe('Playlists (e2e)', () => {
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
    mocks.firestore._docRef.set.mockReset();
    mocks.firestore._docRef.delete.mockReset();
    mocks.firestore._collectionRef.get.mockReset();
    mocks.firestore._collectionRef.add.mockReset();
    mocks.firestore._docRef.delete.mockResolvedValue(undefined);
    mocks.firestore._docRef.set.mockResolvedValue(undefined);
    mocks.cache.get.mockResolvedValue(null);
    mocks.cache.set.mockResolvedValue(undefined);
  });

  describe('POST /playlists', () => {
    it('201 with ownerUid matching authenticated user UID', async () => {
      mocks.firestore._collectionRef.add.mockResolvedValue({ id: 'playlist-1' });

      const res = await request(app.getHttpServer())
        .post('/playlists')
        .set('x-test-user', AUTH_USER)
        .send({ name: 'My Playlist' });

      expect(res.status).toBe(201);
      expect(res.body.ownerUid).toBe('user-1');
      expect(res.body.id).toBe('playlist-1');
    });

    it('401 without auth', async () => {
      const res = await request(app.getHttpServer())
        .post('/playlists')
        .send({ name: 'My Playlist' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /playlists', () => {
    it('200 array of playlists owned by authenticated user', async () => {
      const playlistDoc = makePlaylistDoc({ ownerUid: 'user-1' });
      mocks.firestore._collectionRef.get.mockResolvedValue({
        docs: [playlistDoc],
        empty: false,
        size: 1,
      });

      const res = await request(app.getHttpServer())
        .get('/playlists')
        .set('x-test-user', AUTH_USER);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('401 without auth', async () => {
      const res = await request(app.getHttpServer()).get('/playlists');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /playlists/:id/songs', () => {
    it('403 when caller is not owner', async () => {
      // playlist owned by user-1, caller is user-2
      mocks.firestore._docRef.get.mockResolvedValue(makePlaylistDoc({ ownerUid: 'user-1' }));

      const res = await request(app.getHttpServer())
        .post('/playlists/playlist-1/songs')
        .set('x-test-user', OTHER_USER)
        .send({ songId: 'song-1' });

      expect(res.status).toBe(403);
    });

    it('404 when songId does not exist', async () => {
      // First doc() call: playlist owned by user-1 (ownership check passes)
      // Second doc() call: song not found
      mocks.firestore._docRef.get
        .mockResolvedValueOnce(makePlaylistDoc({ ownerUid: 'user-1' }))
        .mockResolvedValueOnce({ exists: false });

      // subcollection get for position calculation
      mocks.firestore._collectionRef.get.mockResolvedValue({ docs: [], empty: true, size: 0 });

      const res = await request(app.getHttpServer())
        .post('/playlists/playlist-1/songs')
        .set('x-test-user', AUTH_USER)
        .send({ songId: 'nonexistent-song' });

      expect(res.status).toBe(404);
    });

    it('401 without auth', async () => {
      const res = await request(app.getHttpServer())
        .post('/playlists/playlist-1/songs')
        .send({ songId: 'song-1' });

      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /playlists/:id', () => {
    it('204 when called by owner', async () => {
      mocks.firestore._docRef.get.mockResolvedValue(makePlaylistDoc({ ownerUid: 'user-1' }));

      const res = await request(app.getHttpServer())
        .delete('/playlists/playlist-1')
        .set('x-test-user', AUTH_USER);

      expect(res.status).toBe(204);
    });

    it('403 when called by non-owner', async () => {
      mocks.firestore._docRef.get.mockResolvedValue(makePlaylistDoc({ ownerUid: 'user-1' }));

      const res = await request(app.getHttpServer())
        .delete('/playlists/playlist-1')
        .set('x-test-user', OTHER_USER);

      expect(res.status).toBe(403);
    });

    it('401 without auth', async () => {
      const res = await request(app.getHttpServer()).delete('/playlists/playlist-1');
      expect(res.status).toBe(401);
    });
  });

  describe('DELETE /playlists/:id/songs/:songId', () => {
    it('204 when called by owner', async () => {
      mocks.firestore._docRef.get.mockResolvedValue(makePlaylistDoc({ ownerUid: 'user-1' }));

      const res = await request(app.getHttpServer())
        .delete('/playlists/playlist-1/songs/song-1')
        .set('x-test-user', AUTH_USER);

      expect(res.status).toBe(204);
    });

    it('401 without auth', async () => {
      const res = await request(app.getHttpServer())
        .delete('/playlists/playlist-1/songs/song-1');

      expect(res.status).toBe(401);
    });
  });
});
