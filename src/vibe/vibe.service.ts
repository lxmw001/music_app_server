import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '../sync/gemini.service';
import { YouTubeService } from '../sync/youtube.service';
import { FirestoreService } from '../firestore/firestore.service';
import { SearchSongDto } from '../songs/dto/search-youtube-response.dto';
import { VibeRequestDto } from './dto/vibe-request.dto';

const MIX_KEYWORDS = /\b(mix|playlist|compilation|megamix|nonstop|non-stop|mashup|medley|vol\.|best of|greatest hits|top \d|hits|set)\b/i;
const CACHE_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class VibeService {
  private readonly logger = new Logger(VibeService.name);
  private readonly memCache = new Map<string, { result: SearchSongDto[]; expiresAt: number }>();

  constructor(
    private readonly gemini: GeminiService,
    private readonly youtube: YouTubeService,
    private readonly firestore: FirestoreService,
  ) {}

  private revalidating = new Set<string>();

  async generate(dto: VibeRequestDto, limit = 20): Promise<SearchSongDto[]> {
    const cacheKey = this.buildCacheKey(dto);

    const cached = this.memCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.log(`Memory cache hit for vibe ${cacheKey}`);
      return cached.result;
    }

    // If expired or missing, find nearest existing cache entry as fallback
    const fallback = this.getNearestCache(dto);

    if (fallback && !this.revalidating.has(cacheKey)) {
      // Return stale/nearest data immediately, refresh in background
      this.logger.log(`Returning nearest cache for ${cacheKey}, refreshing in background`);
      this.revalidating.add(cacheKey);
      this.fetchAndCache(dto, limit, cacheKey).finally(() => this.revalidating.delete(cacheKey));
      return fallback;
    }

    if (this.revalidating.has(cacheKey) && fallback) {
      // Already refreshing, return fallback
      return fallback;
    }

    // No fallback at all — must wait
    return this.fetchAndCache(dto, limit, cacheKey);
  }

  private getNearestCache(dto: VibeRequestDto): SearchSongDto[] | null {
    // Find any cache entry for same vibeId + subCategoryKey regardless of time bucket
    const prefix = [
      dto.vibeId,
      dto.subCategoryKey || '',
      (dto.genres || []).sort().join('-'),
      dto.birthYear ? String(dto.birthYear) : '',
    ].join('_').replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();

    let best: { result: SearchSongDto[]; expiresAt: number } | null = null;
    for (const [key, entry] of this.memCache.entries()) {
      if (key.startsWith(prefix) && (!best || entry.expiresAt > best.expiresAt)) {
        best = entry;
      }
    }
    return best?.result ?? null;
  }

  private async fetchAndCache(dto: VibeRequestDto, limit: number, cacheKey: string): Promise<SearchSongDto[]> {
    const vibeDoc = await this.firestore.doc(`vibes/${dto.vibeId}`).get();
    const vibeData = vibeDoc.exists ? vibeDoc.data()! : null;
    const vibePromptLabel: string = vibeData?.promptLabel ?? dto.vibeId;
    const subCategoryPromptLabel: string | undefined = dto.subCategoryKey
      ? (vibeData?.subCategories ?? []).find((s: any) => s.labelKey === dto.subCategoryKey)?.promptLabel ?? dto.subCategoryKey
      : undefined;

    const queries = await this.gemini.generateVibeSearchQueries({
      vibeId: vibePromptLabel,
      subCategory: subCategoryPromptLabel,
      birthYear: dto.birthYear,
      genres: dto.genres,
      localTime: dto.localTime,
      dayOfWeek: dto.dayOfWeek,
    });

    if (queries.length === 0) return [];

    const query = queries[Math.floor(Math.random() * queries.length)];
    this.logger.log(`Vibe query selected: "${query}"`);

    const videos = await this.youtube.searchVideos(query, 30);

    const result: SearchSongDto[] = videos
      .filter(v => v.playable !== false && (MIX_KEYWORDS.test(v.title) || (v.durationSeconds ?? 0) > 20 * 60))
      .slice(0, limit)
      .map((v, i) => ({
        title: v.title,
        artistName: v.channelTitle || '',
        youtubeId: v.videoId,
        thumbnailUrl: v.thumbnailUrl,
        duration: v.durationSeconds || 0,
        rank: i + 1,
        genres: dto.genres || [],
        tags: [],
        streamUrl: null,
        streamUrlExpiresAt: null,
      }));

    this.memCache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
    return result;
  }

  private buildCacheKey(dto: VibeRequestDto): string {
    const timeOfDay = dto.localTime ? (() => {
      const h = new Date(dto.localTime).getHours();
      if (h >= 6 && h < 10) return 'morning';
      if (h >= 10 && h < 18) return 'afternoon';
      if (h >= 18 && h < 22) return 'evening';
      return 'night';
    })() : '';

    return [
      dto.vibeId,
      dto.subCategoryKey || '',
      (dto.genres || []).sort().join('-'),
      dto.birthYear ? String(dto.birthYear) : '',
      timeOfDay,
      dto.dayOfWeek || '',
    ].join('_').replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  }
}
