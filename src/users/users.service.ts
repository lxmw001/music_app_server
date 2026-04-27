import { Injectable, NotFoundException } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { FirestoreService } from '../firestore/firestore.service';

@Injectable()
export class UsersService {
  constructor(private readonly firestore: FirestoreService) {}

  // ── Liked Songs ────────────────────────────────────────────────────────────

  async getLikedSongs(uid: string): Promise<string[]> {
    const doc = await this.firestore.doc(`users/${uid}`).get();
    if (!doc.exists) return [];
    return doc.data()?.likedSongs ?? [];
  }

  async likeSong(uid: string, songId: string): Promise<{ likedSongs: string[] }> {
    await this.verifySongExists(songId);
    await this.firestore.doc(`users/${uid}`).set(
      { likedSongs: admin.firestore.FieldValue.arrayUnion(songId), updatedAt: new Date() },
      { merge: true },
    );
    return { likedSongs: await this.getLikedSongs(uid) };
  }

  async unlikeSong(uid: string, songId: string): Promise<{ likedSongs: string[] }> {
    await this.firestore.doc(`users/${uid}`).set(
      { likedSongs: admin.firestore.FieldValue.arrayRemove(songId), updatedAt: new Date() },
      { merge: true },
    );
    return { likedSongs: await this.getLikedSongs(uid) };
  }

  async isSongLiked(uid: string, songId: string): Promise<{ liked: boolean }> {
    const liked = await this.getLikedSongs(uid);
    return { liked: liked.includes(songId) };
  }

  // ── Downloaded Songs ───────────────────────────────────────────────────────

  async getDownloadedSongs(uid: string): Promise<string[]> {
    const doc = await this.firestore.doc(`users/${uid}`).get();
    if (!doc.exists) return [];
    return doc.data()?.downloadedSongs ?? [];
  }

  async markDownloaded(uid: string, songId: string): Promise<{ downloadedSongs: string[] }> {
    await this.verifySongExists(songId);
    await this.firestore.doc(`users/${uid}`).set(
      { downloadedSongs: admin.firestore.FieldValue.arrayUnion(songId), updatedAt: new Date() },
      { merge: true },
    );
    return { downloadedSongs: await this.getDownloadedSongs(uid) };
  }

  async removeDownload(uid: string, songId: string): Promise<{ downloadedSongs: string[] }> {
    await this.firestore.doc(`users/${uid}`).set(
      { downloadedSongs: admin.firestore.FieldValue.arrayRemove(songId), updatedAt: new Date() },
      { merge: true },
    );
    return { downloadedSongs: await this.getDownloadedSongs(uid) };
  }

  // ── User Profile ───────────────────────────────────────────────────────────

  async getProfile(uid: string): Promise<{
    uid: string;
    likedSongs: string[];
    downloadedSongs: string[];
    updatedAt?: Date;
  }> {
    const doc = await this.firestore.doc(`users/${uid}`).get();
    if (!doc.exists) {
      return { uid, likedSongs: [], downloadedSongs: [] };
    }
    const data = doc.data()!;
    return {
      uid,
      likedSongs: data.likedSongs ?? [],
      downloadedSongs: data.downloadedSongs ?? [],
      updatedAt: data.updatedAt?.toDate?.(),
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async verifySongExists(songId: string): Promise<void> {
    const doc = await this.firestore.doc(`songs/${songId}`).get();
    if (!doc.exists) throw new NotFoundException('Song not found');
  }
}
