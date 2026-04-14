import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { FirestoreService } from '../firestore/firestore.service';
import { GeminiService } from './gemini.service';
import { YouTubeService } from './youtube.service';
import {
  SyncRequestDto,
  RawYouTubeResult,
  CleanedSongResult,
} from './interfaces/sync.interfaces';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly firestore: FirestoreService,
    private readonly gemini: GeminiService,
    private readonly youtube: YouTubeService,
  ) {}

  async runSync(dto: SyncRequestDto): Promise<void> {
    const { force = false } = dto;
    let genres = dto.genres && dto.genres.length > 0 ? dto.genres : [];

    this.logger.log('Sync pipeline started');

    // Step 1: Auto genre discovery
    if (genres.length === 0) {
      this.logger.log('No genres provided — calling getPopularGenres()');
      genres = await this.gemini.getPopularGenres();
    }

    const allRawResults: RawYouTubeResult[] = [];

    // Steps 2-6: Artist discovery, query generation, cache check, YouTube search
    for (const genre of genres) {
      const artists = await this.gemini.getArtistsForGenre(genre);
      const sortedArtists = [...artists].sort((a, b) => a.rank - b.rank);

      for (const artist of sortedArtists) {
        const queries = await this.gemini.generateSearchQueries(artist.name, artist.topSongs);

        for (const query of queries) {
          const queryHash = this.hashQuery(query);
          const cacheRef = this.firestore.doc(`syncCache/${queryHash}`);

          let results;
          if (!force) {
            const cached = await cacheRef.get();
            if (cached.exists) {
              results = cached.data()!.results;
              this.logger.debug(`Cache hit for query: ${query}`);
            }
          }

          if (!results) {
            results = await this.youtube.search(query);
            await cacheRef.set({
              query,
              results,
              cachedAt: admin.firestore.Timestamp.now(),
            });
          }

          for (const r of results) {
            allRawResults.push({
              ...r,
              genre,
              artistRank: artist.rank,
              artistName: artist.name,
            });
          }
        }
      }
    }

    // Step 7: Clean and deduplicate
    const cleaned = await this.gemini.cleanAndDeduplicate(allRawResults);
    this.logger.log(`Cleaned ${cleaned.length} songs from ${allRawResults.length} raw results`);

    // Steps 8-10: Persist songs, artists, albums
    let processed = 0;
    let skipped = 0;
    let failed = 0;

    // Track genre → songIds and album → songIds for playlist upsert
    const genreSongMap = new Map<string, string[]>();
    const albumSongMap = new Map<string, { albumName: string; songIds: string[] }>();

    for (const song of cleaned) {
      try {
        // Step 10: Deduplication check
        const existing = await this.firestore
          .collection('songs')
          .where('title', '==', song.title)
          .where('artistName', '==', song.artistName)
          .limit(1)
          .get();

        if (!existing.empty) {
          skipped++;
          const existingId = existing.docs[0].id;
          this.trackGenreAndAlbum(genreSongMap, albumSongMap, song, existingId);
          continue;
        }

        // Upsert artist
        const artistId = await this.upsertArtist(song.artistName);

        // Upsert album if present
        let albumId: string | null = null;
        if (song.albumName) {
          albumId = await this.upsertAlbum(song.albumName, artistId);
        }

        // Upsert song
        const songRef = this.firestore.collection('songs').doc();
        await songRef.set({
          title: song.title,
          artistName: song.artistName,
          durationSeconds: song.durationSeconds ?? 0,
          coverImageUrl: null,
          youtubeId: song.youtubeId,
          youtubeIdPendingReview: false,
          artistId,
          albumId,
          genre: song.genre,
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        });

        this.trackGenreAndAlbum(genreSongMap, albumSongMap, song, songRef.id);
        if (albumId && song.albumName) {
          const entry = albumSongMap.get(albumId);
          if (entry) entry.albumName = song.albumName;
        }

        processed++;
      } catch (error) {
        this.logger.error(
          `Failed to persist song "${song.title}" by "${song.artistName}": ${(error as Error).message}`,
        );
        failed++;
      }
    }

    // Step 12: Genre playlist upsert
    for (const genre of genres) {
      try {
        const songIds = genreSongMap.get(genre) ?? [];
        if (songIds.length === 0) continue;
        const playlistId = await this.upsertSystemPlaylist(genre, 'genre');
        await this.upsertPlaylistSongs(playlistId, songIds);
      } catch (error) {
        this.logger.error(`Genre playlist upsert failed for "${genre}": ${(error as Error).message}`);
      }
    }

    // Step 12: Album playlist upsert
    for (const [albumId, { albumName, songIds }] of albumSongMap.entries()) {
      try {
        if (songIds.length === 0) continue;
        const playlistId = await this.upsertSystemPlaylist(albumName, 'album', albumId);
        await this.upsertPlaylistSongs(playlistId, songIds);
      } catch (error) {
        this.logger.error(`Album playlist upsert failed for "${albumName}": ${(error as Error).message}`);
      }
    }

    // Step 13: Summary
    this.logger.log(
      `Sync complete — processed: ${processed}, skipped: ${skipped}, failed: ${failed}`,
    );
  }

  private hashQuery(query: string): string {
    return crypto.createHash('sha256').update(query.trim().toLowerCase()).digest('hex');
  }

  private trackGenreAndAlbum(
    genreSongMap: Map<string, string[]>,
    albumSongMap: Map<string, { albumName: string; songIds: string[] }>,
    song: CleanedSongResult,
    songId: string,
  ): void {
    if (!genreSongMap.has(song.genre)) genreSongMap.set(song.genre, []);
    genreSongMap.get(song.genre)!.push(songId);

    if (song.albumName) {
      const albumKey = `album_${song.albumName.toLowerCase()}`;
      if (!albumSongMap.has(albumKey)) {
        albumSongMap.set(albumKey, { albumName: song.albumName, songIds: [] });
      }
      albumSongMap.get(albumKey)!.songIds.push(songId);
    }
  }

  private async upsertArtist(name: string): Promise<string> {
    const existing = await this.firestore
      .collection('artists')
      .where('name', '==', name)
      .limit(1)
      .get();

    if (!existing.empty) return existing.docs[0].id;

    const ref = this.firestore.collection('artists').doc();
    await ref.set({
      name,
      biography: '',
      profileImageUrl: null,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    });
    return ref.id;
  }

  private async upsertAlbum(title: string, artistId: string): Promise<string> {
    const existing = await this.firestore
      .collection('albums')
      .where('title', '==', title)
      .where('artistId', '==', artistId)
      .limit(1)
      .get();

    if (!existing.empty) return existing.docs[0].id;

    const ref = this.firestore.collection('albums').doc();
    await ref.set({
      title,
      releaseYear: new Date().getFullYear(),
      coverImageUrl: null,
      artistId,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    });
    return ref.id;
  }

  private async upsertSystemPlaylist(
    name: string,
    type: 'genre' | 'album',
    existingId?: string,
  ): Promise<string> {
    const query = this.firestore
      .collection('playlists')
      .where('name', '==', name)
      .where('type', '==', type)
      .where('ownerUid', '==', null)
      .limit(1);

    const snapshot = await query.get();
    if (!snapshot.empty) return snapshot.docs[0].id;

    const ref = existingId
      ? this.firestore.doc(`playlists/${existingId}`)
      : this.firestore.collection('playlists').doc();

    await ref.set({
      name,
      description: null,
      ownerUid: null,
      type,
      createdAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now(),
    });
    return ref.id;
  }

  private async upsertPlaylistSongs(playlistId: string, songIds: string[]): Promise<void> {
    const songsCol = this.firestore.collection(`playlists/${playlistId}/songs`);
    const existing = await songsCol.get();
    const existingIds = new Set(existing.docs.map((d) => d.id));

    let position = existing.docs.length;
    for (const songId of songIds) {
      if (existingIds.has(songId)) continue;
      await songsCol.doc(songId).set({
        position: position++,
        addedAt: admin.firestore.Timestamp.now(),
      });
    }
  }
}
