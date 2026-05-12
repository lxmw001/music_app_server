import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '../sync/gemini.service';
import { LastFmService } from '../sync/lastfm.service';
import { FirestoreService } from '../firestore/firestore.service';
import { SearchSongDto } from '../songs/dto/search-youtube-response.dto';
import { VibeRequestDto } from './dto/vibe-request.dto';

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class VibeService {
  private readonly logger = new Logger(VibeService.name);

  constructor(
    private readonly gemini: GeminiService,
    private readonly lastfm: LastFmService,
    private readonly firestore: FirestoreService,
  ) {}

  async generate(dto: VibeRequestDto, limit = 10): Promise<SearchSongDto[]> {
    const cacheKey = this.buildCacheKey(dto, limit);

    const cached = await this.firestore.doc(`vibe_playlists/${cacheKey}`).get();
    if (cached.exists) {
      const data = cached.data()!;
      const isStale = !data.lastUpdated || (Date.now() - data.lastUpdated.toDate().getTime()) > CACHE_TTL_MS;
      if (!isStale) {
        this.logger.log(`Returning cached vibe playlist for ${cacheKey}`);
        const docs = await Promise.all((data.songs ?? []).map((id: string) => this.firestore.doc(`songs/${id}`).get()));
        return docs.filter(d => d.exists).map(d => this.toDto(d.id, d.data()));
      }
    }

    const suggestions = await this.gemini.generateVibeQueries({ ...dto, limit });
    if (suggestions.length === 0) return [];

    const playlist: SearchSongDto[] = [];

    for (const song of suggestions) {
      try {
        const existing = await this.firestore.collection('songs')
          .where('youtubeId', '==', song.youtubeId)
          .limit(1)
          .get();

        if (!existing.empty) {
          playlist.push(this.toDto(existing.docs[0].id, existing.docs[0].data()));
          continue;
        }

        const metadata = await this.lastfm.searchTrack(song.title, song.artistName);

        const songData: any = {
          title: song.title,
          artistName: song.artistName,
          youtubeId: song.youtubeId,
          nameLower: song.title.toLowerCase(),
          coverImageUrl: metadata?.albumArt || null,
          durationSeconds: 0,
          genres: metadata?.tags || [],
          listeners: metadata?.listeners || 0,
          tags: metadata?.rawTags || [],
          album: metadata?.album || null,
          releaseDate: metadata?.releaseDate || null,
          mbid: metadata?.mbid || null,
          searchTokens: this.generateSearchTokens(`${song.title} ${song.artistName}`),
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const docRef = await this.firestore.collection('songs').add(songData);
        playlist.push(this.toDto(docRef.id, songData));
      } catch (err) {
        this.logger.warn(`Failed to process vibe song ${song.title}: ${err.message}`);
      }
    }

    await this.firestore.doc(`vibe_playlists/${cacheKey}`).set({
      songs: playlist.map(s => s.id).filter(Boolean),
      lastUpdated: new Date(),
    });

    return playlist;
  }

  private buildCacheKey(dto: VibeRequestDto, limit: number): string {
    const timeOfDay = dto.localTime ? (() => {
      const h = new Date(dto.localTime).getHours();
      if (h >= 6 && h < 10) return 'morning';
      if (h >= 10 && h < 18) return 'afternoon';
      if (h >= 18 && h < 22) return 'evening';
      return 'night';
    })() : '';

    return [
      dto.vibeId,
      dto.subCategory || '',
      (dto.genres || []).sort().join('-'),
      dto.birthYear ? String(dto.birthYear) : '',
      timeOfDay,
      dto.dayOfWeek || '',
      String(limit),
    ].join('_').replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  }

  private toDto(id: string, data: any): SearchSongDto {
    return {
      id,
      title: data.title,
      artistName: data.artistName,
      youtubeId: data.youtubeId,
      thumbnailUrl: data.coverImageUrl,
      duration: data.durationSeconds || 0,
      rank: 0,
      artistId: data.artistId,
      albumId: data.albumId,
      album: data.album,
      genres: data.genres || [],
      tags: data.tags || [],
      listeners: data.listeners,
      mbid: data.mbid,
      ...this.resolveStreamUrl(data),
    };
  }

  private resolveStreamUrl(data: any): { streamUrl: string | null; streamUrlExpiresAt: string | null } {
    if (!data.streamUrl || !data.streamUrlExpiresAt) return { streamUrl: null, streamUrlExpiresAt: null };
    const expiresAt = data.streamUrlExpiresAt?.toDate?.() ?? new Date(data.streamUrlExpiresAt);
    if (expiresAt <= new Date()) return { streamUrl: null, streamUrlExpiresAt: null };
    return { streamUrl: data.streamUrl, streamUrlExpiresAt: expiresAt.toISOString() };
  }

  private generateSearchTokens(text: string): string[] {
    const normalized = text.toLowerCase();
    const tokens = new Set<string>();
    const words = normalized.split(/[\s\-_.,!?()]+/).filter(w => w.length > 0);
    for (const word of words) {
      if (word.length >= 3) {
        tokens.add(word);
        for (let i = 3; i <= word.length; i++) tokens.add(word.substring(0, i));
      }
    }
    return Array.from(tokens);
  }
}
