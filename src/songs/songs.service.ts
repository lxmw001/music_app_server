import { Inject, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import * as admin from 'firebase-admin';
import { FirestoreService } from '../firestore/firestore.service';
import { GeminiService } from '../sync/gemini.service';
import { CacheKeys } from '../cache/cache-keys';
import { PaginationDto } from './dto/pagination.dto';
import { SongResponseDto } from './dto/song-response.dto';
import { SubmitSearchDto } from './dto/submit-search.dto';

interface SongDocument {
  title: string;
  artistName: string;
  durationSeconds: number;
  coverImageUrl: string | null;
  youtubeId: string | null;
  youtubeIdPendingReview: boolean;
  artistId: string | null;
  albumId: string | null;
  genre: string | null;
  tags: string[];
  searchQuery: string;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

@Injectable()
export class SongsService {
  private readonly logger = new Logger(SongsService.name);

  constructor(
    private readonly firestore: FirestoreService,
    private readonly gemini: GeminiService,
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

  async submitSearch(dto: SubmitSearchDto): Promise<{ processed: number; message: string }> {
    try {
      // Auto-generate tags from search query if not provided
      const tags = dto.tags && dto.tags.length > 0 
        ? dto.tags 
        : this.generateTagsFromQuery(dto.searchQuery);

      // Convert to format Gemini expects
      const rawResults = dto.results.map(r => ({
        videoId: r.videoId,
        title: r.title,
        channelTitle: r.channelTitle,
        thumbnailUrl: r.thumbnailUrl,
        durationSeconds: r.durationSeconds,
        genre: tags[0] || 'Unknown',
        artistRank: 1,
        artistName: r.channelTitle,
      }));

      // Clean with Gemini
      const cleaned = await this.gemini.cleanAndDeduplicate(rawResults);
      
      let processed = 0;
      for (const song of cleaned) {
        // Check if already exists
        const existing = await this.firestore
          .collection('songs')
          .where('youtubeId', '==', song.youtubeId)
          .limit(1)
          .get();

        if (!existing.empty) continue;

        // Save song
        const songRef = this.firestore.collection('songs').doc();
        const titleLower = song.title.toLowerCase();
        const searchTokens = this.generateSearchTokens(song.title);
        
        await songRef.set({
          title: song.title,
          artistName: song.artistName,
          nameLower: titleLower,
          searchTokens,
          durationSeconds: song.durationSeconds || 0,
          coverImageUrl: song.thumbnailUrl || null,
          youtubeId: song.youtubeId,
          youtubeIdPendingReview: false,
          artistId: null,
          albumId: null,
          genre: song.genre || null,
          tags,
          searchQuery: dto.searchQuery,
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        });

        processed++;
      }

      return {
        processed,
        message: `Processed ${processed} songs from search "${dto.searchQuery}"`,
      };
    } catch (error) {
      this.logger.error(`submitSearch failed: ${(error as Error).message}`);
      throw error;
    }
  }

  private generateTagsFromQuery(query: string): string[] {
    const normalized = query.toLowerCase().trim();
    const tags = new Set<string>();
    
    // Add full query
    tags.add(normalized);
    
    // Split by spaces and add individual words (min 3 chars)
    const words = normalized.split(/[\s\-_]+/).filter(w => w.length >= 3);
    words.forEach(word => tags.add(word));
    
    // Remove year patterns (2024, 2023, etc.)
    return Array.from(tags).filter(tag => !/^\d{4}$/.test(tag));
  }

  private generateSearchTokens(text: string): string[] {
    const normalized = text.toLowerCase();
    const tokens = new Set<string>();
    
    // Split by spaces and special characters
    const words = normalized.split(/[\s\-_.,!?()]+/).filter(w => w.length > 0);
    
    // Add each word and its prefixes (min 3 chars)
    for (const word of words) {
      if (word.length >= 3) {
        tokens.add(word);
        // Add prefixes for autocomplete
        for (let i = 3; i <= word.length; i++) {
          tokens.add(word.substring(0, i));
        }
      }
    }
    
    return Array.from(tokens);
  }
}
