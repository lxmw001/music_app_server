import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as admin from 'firebase-admin';
import { FirestoreService } from '../firestore/firestore.service';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { PlaylistResponseDto } from './dto/playlist-response.dto';

interface PlaylistDocument {
  name: string;
  description: string | null;
  ownerUid: string | null;
  type: 'user' | 'genre' | 'album';
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

interface PlaylistSongDocument {
  position: number;
  addedAt: FirebaseFirestore.Timestamp;
}

@Injectable()
export class PlaylistsService {
  constructor(private readonly firestore: FirestoreService) {}

  async findById(playlistId: string, ownerUid: string): Promise<PlaylistResponseDto & { songs: string[] }> {
    const doc = await this.firestore.doc(`playlists/${playlistId}`).get();
    if (!doc.exists) throw new NotFoundException('Playlist not found');

    const data = doc.data() as PlaylistDocument;
    if (data.ownerUid !== ownerUid && data.ownerUid !== null) {
      throw new ForbiddenException('You do not have permission to view this playlist');
    }

    const songsSnapshot = await this.firestore
      .collection(`playlists/${playlistId}/songs`)
      .orderBy('position', 'asc')
      .get();

    const songIds = songsSnapshot.docs.map(d => d.id);

    return {
      id: doc.id,
      name: data.name,
      description: data.description,
      ownerUid: data.ownerUid,
      type: data.type,
      createdAt: data.createdAt,
      songs: songIds,
    };
  }

  async getSongs(playlistId: string, ownerUid: string): Promise<string[]> {
    const doc = await this.firestore.doc(`playlists/${playlistId}`).get();
    if (!doc.exists) throw new NotFoundException('Playlist not found');

    const data = doc.data() as PlaylistDocument;
    if (data.ownerUid !== ownerUid && data.ownerUid !== null) {
      throw new ForbiddenException('You do not have permission to view this playlist');
    }

    const songsSnapshot = await this.firestore
      .collection(`playlists/${playlistId}/songs`)
      .orderBy('position', 'asc')
      .get();

    return songsSnapshot.docs.map(d => d.id);
  }

  async create(
    ownerUid: string,
    dto: CreatePlaylistDto,
  ): Promise<PlaylistResponseDto> {
    const now = admin.firestore.Timestamp.now();
    const data: PlaylistDocument = {
      name: dto.name,
      description: dto.description ?? null,
      ownerUid,
      type: 'user',
      createdAt: now,
      updatedAt: now,
    };

    const ref = await this.firestore.collection('playlists').add(data);
    return {
      id: ref.id,
      name: data.name,
      description: data.description,
      ownerUid: data.ownerUid,
      type: data.type,
      createdAt: data.createdAt,
    };
  }

  async findAllForUser(ownerUid: string): Promise<PlaylistResponseDto[]> {
    const snapshot = await this.firestore
      .collection('playlists')
      .where('ownerUid', '==', ownerUid)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data() as PlaylistDocument;
      return {
        id: doc.id,
        name: data.name,
        description: data.description,
        ownerUid: data.ownerUid,
        type: data.type,
        createdAt: data.createdAt,
      };
    });
  }

  async addSong(
    playlistId: string,
    songId: string,
    ownerUid: string,
  ): Promise<void> {
    await this.verifyOwnership(playlistId, ownerUid);

    const songDoc = await this.firestore.doc(`songs/${songId}`).get();
    if (!songDoc.exists) {
      throw new NotFoundException('Song not found');
    }

    const songsRef = this.firestore.collection(
      `playlists/${playlistId}/songs`,
    );
    const existingSnapshot = await songsRef.get();
    const position = existingSnapshot.size + 1;

    const songData: PlaylistSongDocument = {
      position,
      addedAt: admin.firestore.Timestamp.now(),
    };

    await songsRef.doc(songId).set(songData);
  }

  async removeSong(
    playlistId: string,
    songId: string,
    ownerUid: string,
  ): Promise<void> {
    await this.verifyOwnership(playlistId, ownerUid);

    await this.firestore
      .doc(`playlists/${playlistId}/songs/${songId}`)
      .delete();
  }

  async delete(playlistId: string, ownerUid: string): Promise<void> {
    await this.verifyOwnership(playlistId, ownerUid);
    await this.firestore.doc(`playlists/${playlistId}`).delete();
  }

  private async verifyOwnership(
    playlistId: string,
    ownerUid: string,
  ): Promise<void> {
    const doc = await this.firestore.doc(`playlists/${playlistId}`).get();
    if (!doc.exists) {
      throw new NotFoundException('Playlist not found');
    }

    const data = doc.data() as PlaylistDocument;
    if (data.ownerUid !== ownerUid) {
      throw new ForbiddenException(
        'You do not have permission to modify this playlist',
      );
    }
  }
}
