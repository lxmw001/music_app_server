import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from '../sync/gemini.service';
import { YouTubeService } from '../sync/youtube.service';
import { FirestoreService } from '../firestore/firestore.service';
import { SearchMixDto } from '../songs/dto/search-youtube-response.dto';
import { VibeRequestDto } from './dto/vibe-request.dto';

const MIX_KEYWORDS = /\b(mix|playlist|compilation|megamix|nonstop|non-stop|mashup|medley|vol\.|best of|greatest hits|top \d|hits|set)\b/i;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour in-memory

@Injectable()
export class VibeService {
  private readonly logger = new Logger(VibeService.name);
  private readonly memCache = new Map<string, { result: SearchMixDto[]; expiresAt: number }>();

  constructor(
    private readonly gemini: GeminiService,
    private readonly youtube: YouTubeService,
    private readonly firestore: FirestoreService,
  ) {}

  async generate(dto: VibeRequestDto, limit = 20): Promise<SearchMixDto[]> {
    const cacheKey = this.buildCacheKey(dto);

    const cached = this.memCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.logger.log(`Memory cache hit for vibe ${cacheKey}`);
      return cached.result;
    }

    // Resolve promptLabels from vibes collection
    const vibeDoc = await this.firestore.doc(`vibes/${dto.vibeId}`).get();
    const vibeData = vibeDoc.exists ? vibeDoc.data()! : null;
    const vibePromptLabel: string = vibeData?.promptLabel ?? dto.vibeId;
    const subCategoryPromptLabel: string | undefined = dto.subCategoryKey
      ? (vibeData?.subCategories ?? []).find((s: any) => s.labelKey === dto.subCategoryKey)?.promptLabel ?? dto.subCategoryKey
      : undefined;

    // Generate search queries via Gemini
    const queries = await this.gemini.generateVibeSearchQueries({
      vibeId: vibePromptLabel,
      subCategory: subCategoryPromptLabel,
      birthYear: dto.birthYear,
      genres: dto.genres,
      localTime: dto.localTime,
      dayOfWeek: dto.dayOfWeek,
    });

    if (queries.length === 0) {
      this.logger.warn(`No queries generated for vibe ${cacheKey}`);
      return [];
    }

    // Pick one query at random
    const query = queries[Math.floor(Math.random() * queries.length)];
    this.logger.log(`Vibe query selected: "${query}"`);

    // YouTube search
    const videos = await this.youtube.searchVideos(query, 30);

    // Filter mixes only
    const mixes: SearchMixDto[] = videos
      .filter(v => MIX_KEYWORDS.test(v.title) || (v.durationSeconds ?? 0) > 20 * 60)
      .slice(0, limit)
      .map((v, i) => ({
        title: v.title,
        youtubeId: v.videoId,
        thumbnailUrl: v.thumbnailUrl,
        rank: i + 1,
        genres: dto.genres || [],
        streamUrl: null,
        streamUrlExpiresAt: null,
      }));

    this.memCache.set(cacheKey, { result: mixes, expiresAt: Date.now() + CACHE_TTL_MS });
    return mixes;
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
