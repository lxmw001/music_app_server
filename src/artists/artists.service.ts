import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { FirestoreService } from '../firestore/firestore.service';
import { CacheKeys } from '../cache/cache-keys';
import { PaginationDto } from '../songs/dto/pagination.dto';
import { ArtistResponseDto } from './dto/artist-response.dto';
import { SongResponseDto } from '../songs/dto/song-response.dto';
import { AlbumResponseDto } from '../albums/dto/album-response.dto';

interface ArtistDocument {
  name: string;
  biography: string;
  profileImageUrl: string | null;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

interface SongDocument {
  title: string;
  durationSeconds: number;
  coverImageUrl: string | null;
  youtubeId: string | null;
  youtubeIdPendingReview: boolean;
  artistId: string;
  albumId: string | null;
  genre: string | null;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

interface AlbumDocument {
  title: string;
  releaseYear: number;
  coverImageUrl: string | null;
  artistId: string;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

@Injectable()
export class ArtistsService {
  constructor(
    private readonly firestore: FirestoreService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async findById(id: string): Promise<ArtistResponseDto> {
    const key = CacheKeys.artist(id);
    const cached = await this.cache.get<ArtistResponseDto>(key);
    if (cached) return cached;

    const doc = await this.firestore.doc(`artists/${id}`).get();
    if (!doc.exists) throw new NotFoundException('Artist not found');

    const data = doc.data() as ArtistDocument;
    const response: ArtistResponseDto = {
      id: doc.id,
      name: data.name,
      biography: data.biography,
      profileImageUrl: data.profileImageUrl,
    };

    await this.cache.set(key, response, 300_000);
    return response;
  }

  async findAll(pagination: PaginationDto): Promise<ArtistResponseDto[]> {
    const { page, pageSize } = pagination;
    const limit = page * pageSize;

    const snapshot = await this.firestore
      .collection('artists')
      .orderBy('createdAt')
      .limit(limit)
      .get();

    const docs = snapshot.docs.slice((page - 1) * pageSize);

    return docs.map((doc) => {
      const data = doc.data() as ArtistDocument;
      return {
        id: doc.id,
        name: data.name,
        biography: data.biography,
        profileImageUrl: data.profileImageUrl,
      };
    });
  }

  async findSongs(artistId: string): Promise<SongResponseDto[]> {
    const snapshot = await this.firestore
      .collection('songs')
      .where('artistId', '==', artistId)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data() as SongDocument;
      return {
        id: doc.id,
        title: data.title,
        artistId: data.artistId,
        albumId: data.albumId,
        durationSeconds: data.durationSeconds,
        coverImageUrl: data.coverImageUrl,
        youtubeId: data.youtubeId,
        genre: data.genre,
      };
    });
  }

  async findAlbums(artistId: string): Promise<AlbumResponseDto[]> {
    const snapshot = await this.firestore
      .collection('albums')
      .where('artistId', '==', artistId)
      .get();

    return snapshot.docs.map((doc) => {
      const data = doc.data() as AlbumDocument;
      return {
        id: doc.id,
        title: data.title,
        releaseYear: data.releaseYear,
        coverImageUrl: data.coverImageUrl,
        artistId: data.artistId,
      };
    });
  }
}
