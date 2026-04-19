import { Inject, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import * as admin from 'firebase-admin';
import { FirestoreService } from '../firestore/firestore.service';
import { GeminiService } from '../sync/gemini.service';
import { YouTubeService } from '../sync/youtube.service';
import { CacheKeys } from '../cache/cache-keys';
import { PaginationDto } from './dto/pagination.dto';
import { SongResponseDto } from './dto/song-response.dto';
import { SubmitSearchDto } from './dto/submit-search.dto';
import { SearchYouTubeDto } from './dto/search-youtube.dto';
import { SearchYouTubeResponseDto } from './dto/search-youtube-response.dto';

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
    private readonly youtube: YouTubeService,
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

  async cleanYouTubeResults(results: Array<{
    videoId: string;
    title: string;
    channelTitle: string;
    thumbnailUrl?: string;
    durationSeconds?: number;
  }>): Promise<any[]> {
    const videoIds = results.map(r => r.videoId);
    
    // Check which songs already exist in DB
    const existingSongs = new Map();
    const chunks = this.chunkArray(videoIds, 10);
    
    for (const chunk of chunks) {
      const snapshot = await this.firestore.collection('songs')
        .where('youtubeId', 'in', chunk)
        .get();
      
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        existingSongs.set(data.youtubeId, {
          id: doc.id,
          title: data.title,
          artistName: data.artistName,
          youtubeId: data.youtubeId,
          thumbnailUrl: data.coverImageUrl,
          durationSeconds: data.durationSeconds,
          tags: data.tags || [],
        });
      });
    }
    
    // Separate cached vs new
    const cached = [];
    const needsCleaning = [];
    
    for (const result of results) {
      if (existingSongs.has(result.videoId)) {
        cached.push(existingSongs.get(result.videoId));
      } else {
        needsCleaning.push(result);
      }
    }
    
    // Clean new results
    const cleaned = [];
    if (needsCleaning.length > 0) {
      const prompt = `Clean YouTube music results. Extract song title and artist. Remove: (Official Video), (Lyrics), [Official], VEVO, etc. Fix caps. Return JSON: [{"title":"Song","artistName":"Artist","videoId":"abc"}]. Input: ${JSON.stringify(needsCleaning.map(r => ({ videoId: r.videoId, title: r.title })))}`;

      try {
        const text = await this.gemini.generate(prompt);
        const parsed = JSON.parse(this.extractJson(text));
        
        for (const item of parsed) {
          const original = needsCleaning.find(r => r.videoId === item.videoId);
          const songData = {
            title: item.title,
            artistName: item.artistName,
            youtubeId: item.videoId,
            nameLower: item.title.toLowerCase(),
            coverImageUrl: original?.thumbnailUrl || '',
            durationSeconds: original?.durationSeconds || 0,
            tags: [],
            searchTokens: this.generateSearchTokens(item.title + ' ' + item.artistName),
            createdAt: new Date(),
          };
          
          const docRef = await this.firestore.collection('songs').add(songData);
          cleaned.push({ id: docRef.id, ...songData });
        }
      } catch (error) {
        this.logger.error(`Clean failed: ${error.message}`);
      }
    }
    
    return [...cached, ...cleaned];
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  private extractJson(text: string): string {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return match[1].trim();
    
    const start = text.search(/[\[{]/);
    const end = text.lastIndexOf(text[start] === '[' ? ']' : '}');
    
    if (start !== -1 && end !== -1 && end > start) {
      return text.slice(start, end + 1);
    }
    
    return text;
  }

  async searchYouTube(dto: SearchYouTubeDto): Promise<SearchYouTubeResponseDto> {
    const normalizedQuery = dto.query.toLowerCase().trim().replace(/[^\w\s]/g, '');
    
    // Check cache
    const cached = await this.firestore.doc(`youtube_searches/${normalizedQuery}`).get();
    if (cached.exists) {
      const data = cached.data();
      const lastUpdated = data.lastUpdated?.toDate();
      const isStale = !lastUpdated || (Date.now() - lastUpdated.getTime()) > 7 * 24 * 60 * 60 * 1000;
      
      if (!isStale) {
        return this.enrichSearchResults(data);
      }
    }
    
    // YouTube search
    const results = await this.youtube.searchVideos(dto.query, 20);
    
    // Gemini classification
    const prompt = `Classify YouTube results into: songs, mixes, videos, artists.
Rules:
- Songs: Single tracks. Clean title (remove: Official Video, Lyrics, Audio, VEVO). Extract artist.
- Mixes: Playlists, compilations, DJ sets
- Videos: Interviews, behind-scenes, live performances
- Artists: Artist channels

Return JSON:
{
  "songs": [{"title":"Song","artistName":"Artist","videoId":"abc"}],
  "mixes": [{"title":"Mix","videoId":"xyz"}],
  "videos": [{"title":"Video","videoId":"def"}],
  "artists": [{"name":"Artist"}]
}

Input: ${JSON.stringify(results.map(r => ({ videoId: r.videoId, title: r.title, channel: r.channelTitle })))}`;

    const text = await this.gemini.generate(prompt);
    const classified = JSON.parse(this.extractJson(text));
    
    // Save to Firestore
    const searchData = {
      query: dto.query,
      songs: (classified.songs || []).map((s, i) => ({
        ...s,
        rank: i + 1,
        songId: null,
        thumbnailUrl: results.find(r => r.videoId === s.videoId)?.thumbnailUrl || '',
        durationSeconds: results.find(r => r.videoId === s.videoId)?.durationSeconds || 0,
      })),
      mixes: (classified.mixes || []).map((m, i) => ({
        ...m,
        rank: i + 1,
        thumbnailUrl: results.find(r => r.videoId === m.videoId)?.thumbnailUrl || '',
      })),
      videos: (classified.videos || []).map((v, i) => ({
        ...v,
        rank: i + 1,
        thumbnailUrl: results.find(r => r.videoId === v.videoId)?.thumbnailUrl || '',
      })),
      artists: (classified.artists || []).map((a, i) => ({
        ...a,
        rank: i + 1,
        artistId: null,
      })),
      lastUpdated: new Date(),
      createdAt: new Date(),
    };
    
    await this.firestore.doc(`youtube_searches/${normalizedQuery}`).set(searchData);
    
    return this.enrichSearchResults(searchData);
  }

  private async enrichSearchResults(data: any): Promise<SearchYouTubeResponseDto> {
    const songs = await Promise.all(
      (data.songs || []).map(async (s) => {
        if (s.songId) {
          const doc = await this.firestore.doc(`songs/${s.songId}`).get();
          if (doc.exists) {
            const songData = doc.data();
            return {
              id: doc.id,
              title: songData.title,
              artistName: songData.artistName,
              youtubeId: s.youtubeId,
              thumbnailUrl: songData.coverImageUrl || s.thumbnailUrl,
              durationSeconds: songData.durationSeconds,
              rank: s.rank,
              artistId: songData.artistId,
              albumId: songData.albumId,
              genre: songData.genre,
              tags: songData.tags,
            };
          }
        }
        return s;
      })
    );

    const artists = await Promise.all(
      (data.artists || []).map(async (a) => {
        if (a.artistId) {
          const doc = await this.firestore.doc(`artists/${a.artistId}`).get();
          if (doc.exists) {
            const artistData = doc.data();
            return {
              id: doc.id,
              name: artistData.name,
              imageUrl: artistData.imageUrl,
              followerCount: artistData.followerCount,
              rank: a.rank,
            };
          }
        }
        return a;
      })
    );

    return {
      songs,
      mixes: data.mixes || [],
      videos: data.videos || [],
      artists,
    };
  }
}
