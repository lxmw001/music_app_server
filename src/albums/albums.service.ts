import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { FirestoreService } from '../firestore/firestore.service';
import { CacheKeys } from '../cache/cache-keys';
import { PaginationDto } from '../songs/dto/pagination.dto';
import { AlbumResponseDto } from './dto/album-response.dto';

interface AlbumDocument {
  title: string;
  releaseYear: number;
  coverImageUrl: string | null;
  artistId: string;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

@Injectable()
export class AlbumsService {
  constructor(
    private readonly firestore: FirestoreService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async findById(id: string): Promise<AlbumResponseDto> {
    const key = CacheKeys.album(id);
    const cached = await this.cache.get<AlbumResponseDto>(key);
    if (cached) return cached;

    const doc = await this.firestore.doc(`albums/${id}`).get();
    if (!doc.exists) throw new NotFoundException('Album not found');

    const data = doc.data() as AlbumDocument;
    const response: AlbumResponseDto = {
      id: doc.id,
      title: data.title,
      releaseYear: data.releaseYear,
      coverImageUrl: data.coverImageUrl,
      artistId: data.artistId,
    };

    await this.cache.set(key, response, 300_000);
    return response;
  }

  async findAll(pagination: PaginationDto): Promise<AlbumResponseDto[]> {
    const { page, pageSize } = pagination;
    const limit = page * pageSize;

    const snapshot = await this.firestore
      .collection('albums')
      .orderBy('createdAt')
      .limit(limit)
      .get();

    const docs = snapshot.docs.slice((page - 1) * pageSize);

    return docs.map((doc) => {
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
