import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { FirestoreService } from '../firestore/firestore.service';
import { CacheKeys } from '../cache/cache-keys';
import { PaginationDto } from './dto/pagination.dto';
import { SongResponseDto } from './dto/song-response.dto';

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

@Injectable()
export class SongsService {
  constructor(
    private readonly firestore: FirestoreService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async findById(id: string): Promise<SongResponseDto> {
    const key = CacheKeys.song(id);
    const cached = await this.cache.get<SongResponseDto>(key);
    if (cached) return cached;

    const doc = await this.firestore.doc(`songs/${id}`).get();
    if (!doc.exists) throw new NotFoundException('Song not found');

    const data = doc.data() as SongDocument;
    const response: SongResponseDto = {
      id: doc.id,
      title: data.title,
      artistId: data.artistId,
      albumId: data.albumId,
      durationSeconds: data.durationSeconds,
      coverImageUrl: data.coverImageUrl,
      youtubeId: data.youtubeId,
      genre: data.genre,
    };

    await this.cache.set(key, response, 300_000);
    return response;
  }

  async findAll(pagination: PaginationDto): Promise<SongResponseDto[]> {
    const { page, pageSize } = pagination;
    const limit = page * pageSize;

    const snapshot = await this.firestore
      .collection('songs')
      .orderBy('createdAt')
      .limit(limit)
      .get();

    const docs = snapshot.docs.slice((page - 1) * pageSize);

    return docs.map((doc) => {
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
}
