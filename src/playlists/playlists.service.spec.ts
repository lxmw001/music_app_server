import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PlaylistsService } from './playlists.service';
import { FirestoreService } from '../firestore/firestore.service';
import {
  createMockFirestore,
  makePlaylistDoc,
  makeSongDoc,
} from '../../test/shared/mock-factories';

// Mock firebase-admin to avoid real Firebase initialization
jest.mock('firebase-admin', () => ({
  firestore: {
    Timestamp: {
      now: jest.fn().mockReturnValue({ seconds: 1000, nanoseconds: 0 }),
    },
  },
}));

describe('PlaylistsService', () => {
  let service: PlaylistsService;
  let mockFirestore: ReturnType<typeof createMockFirestore>;

  beforeEach(async () => {
    mockFirestore = createMockFirestore();

    const module = await Test.createTestingModule({
      providers: [
        PlaylistsService,
        { provide: FirestoreService, useValue: mockFirestore },
      ],
    }).compile();

    service = module.get(PlaylistsService);
  });

  describe('create', () => {
    it('calls collection("playlists").add() with ownerUid and type "user"', async () => {
      const addedRef = { id: 'new-playlist-id' };
      mockFirestore._collectionRef.add.mockResolvedValue(addedRef);

      const result = await service.create('user-1', { name: 'My Playlist', description: null });

      expect(mockFirestore.collection).toHaveBeenCalledWith('playlists');
      expect(mockFirestore._collectionRef.add).toHaveBeenCalledWith(
        expect.objectContaining({ ownerUid: 'user-1', type: 'user' }),
      );
      expect(result.id).toBe('new-playlist-id');
      expect(result.ownerUid).toBe('user-1');
      expect(result.type).toBe('user');
    });
  });

  describe('findAllForUser', () => {
    it('queries playlists with where ownerUid filter', async () => {
      const docs = [makePlaylistDoc(), makePlaylistDoc({ name: 'Playlist 2' })];
      mockFirestore._collectionRef.get.mockResolvedValue({ docs, empty: false, size: 2 });

      const result = await service.findAllForUser('user-1');

      expect(mockFirestore.collection).toHaveBeenCalledWith('playlists');
      expect(mockFirestore._collectionRef.where).toHaveBeenCalledWith(
        'ownerUid',
        '==',
        'user-1',
      );
      expect(result).toHaveLength(2);
    });
  });

  describe('addSong', () => {
    it('playlist not found: throws NotFoundException', async () => {
      mockFirestore._docRef.get.mockResolvedValue({ exists: false });

      await expect(service.addSong('playlist-1', 'song-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('wrong owner: throws ForbiddenException', async () => {
      mockFirestore._docRef.get.mockResolvedValue(makePlaylistDoc({ ownerUid: 'other-user' }));

      await expect(service.addSong('playlist-1', 'song-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('song not found: throws NotFoundException with "Song not found"', async () => {
      // First call: playlist doc (ownership check passes)
      // Second call: song doc (not found)
      mockFirestore._docRef.get
        .mockResolvedValueOnce(makePlaylistDoc({ ownerUid: 'user-1' }))
        .mockResolvedValueOnce({ exists: false });

      // The songs subcollection get() for position
      mockFirestore._collectionRef.get.mockResolvedValue({ docs: [], empty: true, size: 0 });

      await expect(service.addSong('playlist-1', 'song-1', 'user-1')).rejects.toThrow(
        new NotFoundException('Song not found'),
      );
    });
  });

  describe('removeSong', () => {
    it('wrong owner: throws ForbiddenException', async () => {
      mockFirestore._docRef.get.mockResolvedValue(makePlaylistDoc({ ownerUid: 'other-user' }));

      await expect(service.removeSong('playlist-1', 'song-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('delete', () => {
    it('owner: calls doc.delete()', async () => {
      mockFirestore._docRef.get.mockResolvedValue(makePlaylistDoc({ ownerUid: 'user-1' }));

      await service.delete('playlist-1', 'user-1');

      expect(mockFirestore._docRef.delete).toHaveBeenCalled();
    });

    it('non-owner: throws ForbiddenException', async () => {
      mockFirestore._docRef.get.mockResolvedValue(makePlaylistDoc({ ownerUid: 'other-user' }));

      await expect(service.delete('playlist-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
