import { Inject, Injectable, NotFoundException, Logger, OnModuleInit } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import * as admin from 'firebase-admin';
import { FirestoreService } from '../firestore/firestore.service';
import { GeminiService } from '../sync/gemini.service';
import { YouTubeService } from '../sync/youtube.service';
import { LastFmService } from '../sync/lastfm.service';
import { SongDeduplicationService } from './song-deduplication.service';
import { CacheKeys } from '../cache/cache-keys';
import { PaginationDto } from './dto/pagination.dto';
import { SongResponseDto } from './dto/song-response.dto';
import { SearchYouTubeDto } from './dto/search-youtube.dto';
import { SearchYouTubeResponseDto, SearchSongDto } from './dto/search-youtube-response.dto';

interface SongDocument {
  title: string;
  artistName: string;
  durationSeconds: number;
  coverImageUrl: string | null;
  youtubeId: string | null;
  youtubeIdPendingReview: boolean;
  artistId: string | null;
  albumId: string | null;
  album?: string;
  genre: string | null;
  genres?: string[];
  tags: string[];
  listeners?: number;
  mbid?: string;
  searchQuery: string;
  streamUrl?: string | null;
  streamUrlExpiresAt?: FirebaseFirestore.Timestamp | null;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
}

@Injectable()
export class SongsService implements OnModuleInit {
  private readonly logger = new Logger(SongsService.name);
  private searchesCache: Array<{ query: string; searchCount: number; lastSearched: Date }> = [];

  constructor(
    private readonly firestore: FirestoreService,
    private readonly gemini: GeminiService,
    private readonly youtube: YouTubeService,
    private readonly lastfm: LastFmService,
    private readonly dedup: SongDeduplicationService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async onModuleInit() {
    this.logger.log('Loading all searches into cache on startup');
    await this.loadSearchesCache();
  }

  private async loadSearchesCache() {
    try {
      const snapshot = await this.firestore.collection('youtube_searches')
        .orderBy('searchCount', 'desc')
        .limit(1000)
        .get();

      this.searchesCache = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          query: data.query || doc.id.replace(/-/g, ' '),
          searchCount: data.searchCount || 0,
          lastSearched: data.lastSearched?.toDate() || new Date(),
        };
      });

      this.logger.log(`Loaded ${this.searchesCache.length} searches into cache`);
    } catch (error) {
      this.logger.error(`Failed to load searches cache: ${error.message}`);
    }
  }

  async getAllSearches(): Promise<string[]> {
    return this.searchesCache.map(s => s.query);
  }

  private updateSearchesCache(query: string, searchCount: number, lastSearched: Date) {
    // Find existing entry
    const existingIndex = this.searchesCache.findIndex(s => s.query.toLowerCase() === query.toLowerCase());
    
    if (existingIndex >= 0) {
      // Update existing
      this.searchesCache[existingIndex].searchCount = searchCount;
      this.searchesCache[existingIndex].lastSearched = lastSearched;
    } else {
      // Add new
      this.searchesCache.push({ query, searchCount, lastSearched });
    }

    // Re-sort by searchCount
    this.searchesCache.sort((a, b) => b.searchCount - a.searchCount);

    // Keep only top 1000
    if (this.searchesCache.length > 1000) {
      this.searchesCache = this.searchesCache.slice(0, 1000);
    }
  }

  async findById(id: string): Promise<SearchSongDto> {
    const key = CacheKeys.song(id);
    const cached = await this.cache.get<SearchSongDto>(key);
    if (cached) return cached;

    const doc = await this.firestore.doc(`songs/${id}`).get();
    if (!doc.exists) throw new NotFoundException('Song not found');

    const data = doc.data() as SongDocument;
    const response: SearchSongDto = {
      id: doc.id,
      title: data.title,
      artistName: data.artistName,
      artistId: data.artistId,
      albumId: data.albumId,
      album: data.album,
      duration: data.durationSeconds,
      thumbnailUrl: data.coverImageUrl,
      youtubeId: data.youtubeId,
      genres: data.genres || [],
      tags: data.tags || [],
      listeners: data.listeners,
      mbid: data.mbid,
      rank: 0,
      ...this.resolveStreamUrl(data),
    };

    await this.cache.set(key, response, 300_000);
    return response;
  }

  async findAll(pagination: PaginationDto): Promise<SearchSongDto[]> {
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
        artistName: data.artistName,
        artistId: data.artistId,
        albumId: data.albumId,
        album: data.album,
        duration: data.durationSeconds,
        thumbnailUrl: data.coverImageUrl,
        youtubeId: data.youtubeId,
        genres: data.genres || [],
        tags: data.tags || [],
        listeners: data.listeners,
        mbid: data.mbid,
        rank: 0,
        ...this.resolveStreamUrl(data),
      };
    });
  }

  private generateTagsFromQuery(query: string): string[] {
    const normalized = query.toLowerCase().trim();
    const tags = new Set<string>();

    tags.add(normalized);

    const words = normalized.split(/[\s\-_]+/).filter(w => w.length >= 3);
    words.forEach(word => tags.add(word));

    return Array.from(tags).filter(tag => !/^\d{4}$/.test(tag));
  }

  private generateSearchTokens(text: string): string[] {
    const normalized = text.toLowerCase();
    const tokens = new Set<string>();

    const words = normalized.split(/[\s\-_.,!?()]+/).filter(w => w.length > 0);

    for (const word of words) {
      if (word.length >= 3) {
        tokens.add(word);
        for (let i = 3; i <= word.length; i++) {
          tokens.add(word.substring(0, i));
        }
      }
    }

    return Array.from(tokens);
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
    const normalizedQuery = this.normalizeSearchQuery(dto.query);

    // 1. Check in-memory cache first (5 min TTL)
    const memCacheKey = `yt_search:${normalizedQuery}`;
    const memCached = await this.cache.get<SearchYouTubeResponseDto>(memCacheKey);
    if (memCached) {
      this.logger.log(`Memory cache hit for "${dto.query}"`);
      return memCached;
    }

    // 2. Check Firestore exact match
    let cached = await this.firestore.doc(`youtube_searches/${normalizedQuery}`).get();

    // 3. If no exact match, try fuzzy search
    if (!cached.exists) {
      const fuzzyMatch = await this.findSimilarSearch(dto.query);
      if (fuzzyMatch) {
        cached = fuzzyMatch;
        this.firestore.doc(`youtube_searches/${fuzzyMatch.id}`).update({
          variations: admin.firestore.FieldValue.arrayUnion(dto.query.toLowerCase()),
        }).catch(() => {});
      }
    }

    if (cached.exists) {
      const data = cached.data();
      const lastUpdated = data.lastUpdated?.toDate();
      const isStale = !lastUpdated || (Date.now() - lastUpdated.getTime()) > 7 * 24 * 60 * 60 * 1000;

      this.firestore.doc(`youtube_searches/${cached.id}`).update({
        searchCount: (data.searchCount || 0) + 1,
        lastSearched: new Date(),
      }).catch(() => {});

      // Update in-memory cache
      this.updateSearchesCache(data.query || dto.query, (data.searchCount || 0) + 1, new Date());

      if (!isStale) {
        const result = await this.enrichSearchResults(data);
        await this.cache.set(memCacheKey, result, 300_000);
        return result;
      }

      // Stale-while-revalidate
      this.logger.log(`Stale cache for "${dto.query}" — returning stale, refreshing in background`);
      const staleResult = await this.enrichSearchResults(data);
      await this.cache.set(memCacheKey, staleResult, 300_000);
      this.refreshSearchCache(dto, normalizedQuery).catch(err =>
        this.logger.error(`Background refresh failed for "${dto.query}": ${err.message}`)
      );
      return staleResult;
    }

    return this.refreshSearchCache(dto, normalizedQuery);
  }

  private async refreshSearchCache(dto: SearchYouTubeDto, normalizedQuery: string): Promise<SearchYouTubeResponseDto> {
    // --- Natural language intent parsing ---
    let effectiveQuery = dto.query;
    let intentFilter: { genre?: string; mood?: string; tags?: string[] } | null = null;

    const intent = await this.gemini.parseSearchIntent(dto.query);
    if (intent?.isNaturalLanguage) {
      effectiveQuery = intent.refinedQuery || dto.query;
      intentFilter = {
        genre: intent.genre ?? undefined,
        mood: intent.mood ?? undefined,
        tags: intent.tags?.length ? intent.tags : undefined,
      };
      this.logger.log(
        `NL search: "${dto.query}" → query: "${effectiveQuery}", genre: ${intent.genre}, mood: ${intent.mood}`
      );
    }

    // YouTube search using refined query
    const results = await this.youtube.searchVideos(effectiveQuery, 20);

    const allVideoIds = results.map(r => r.videoId);
    const idChunks = this.chunkArray(allVideoIds, 10);

    // Batch-check both collections in parallel
    const [knownSongSnapshots, knownItemSnapshots] = await Promise.all([
      Promise.all(idChunks.map(chunk =>
        this.firestore.collection('songs').where('youtubeId', 'in', chunk).get()
      )),
      Promise.all(idChunks.map(chunk =>
        this.firestore.collection('youtube_items').where('videoId', 'in', chunk).get()
      )),
    ]);

    // Build known songs map (videoId → song doc)
    const knownSongsMap = new Map<string, any>();
    for (const snapshot of knownSongSnapshots) {
      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.youtubeId) knownSongsMap.set(data.youtubeId, { id: doc.id, ...data });
      }
    }

    // Build known items map (videoId → { type, title, thumbnailUrl })
    const knownItemsMap = new Map<string, any>();
    for (const snapshot of knownItemSnapshots) {
      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.videoId) knownItemsMap.set(data.videoId, data);
      }
    }

    // Separate results into known and unknown
    const unknownForGemini = results.filter(
      r => !knownSongsMap.has(r.videoId) && !knownItemsMap.has(r.videoId)
    );

    this.logger.log(
      `YouTube: ${results.length} results — ${knownSongsMap.size} known songs, ` +
      `${knownItemsMap.size} known items, ${unknownForGemini.length} need Gemini`
    );

    // Build pre-classified lists from known items
    let classifiedMixes: any[] = [];
    let classifiedVideos: any[] = [];
    let classifiedArtists: any[] = [];

    let rankMix = 1, rankVideo = 1, rankArtist = 1;
    for (const result of results) {
      const item = knownItemsMap.get(result.videoId);
      if (!item) continue;
      const entry = { title: item.title, videoId: result.videoId, thumbnailUrl: result.thumbnailUrl || item.thumbnailUrl || '' };
      if (item.type === 'mix') classifiedMixes.push({ ...entry, rank: rankMix++ });
      else if (item.type === 'video') classifiedVideos.push({ ...entry, rank: rankVideo++ });
      else if (item.type === 'artist') classifiedArtists.push({ name: item.title, rank: rankArtist++, artistId: null });
    }

    // --- Hoisted: declared before if/else so both branches and searchData can access them ---
    const songRefs: Array<any> = [];
    const seenDbIds = new Set<string>();
    let rankCounter = 1;

    if (unknownForGemini.length > 0) {
      const prompt = `Classify YouTube music results into: songs, mixes, videos, artists.
Rules:
- Songs: Single music tracks. Clean title (remove: Official Video, Lyrics, Audio, VEVO). Extract artist name. Assign 1-3 music genres.
- Mixes: Playlists, compilations, DJ sets, "Best of" collections, "Top Hits" collections.
- Videos: Interviews, behind-the-scenes, live performances (not music videos).
- Artists: Artist channels or profiles.

Return JSON only:
{
  "songs": [{"title":"Clean Title","artistName":"Artist","videoId":"abc","genres":["genre1"]}],
  "mixes": [{"title":"Mix Title","videoId":"xyz"}],
  "videos": [{"title":"Video Title","videoId":"def"}],
  "artists": [{"name":"Artist Name"}]
}

Input: ${JSON.stringify(unknownForGemini.map(r => ({ videoId: r.videoId, title: r.title, channel: r.channelTitle, duration: r.durationSeconds })))}`;

      const text = await this.gemini.generate(prompt);
      const classified = JSON.parse(this.extractJson(text));

      // Merge Gemini-classified non-song items
      const newMixes = (classified.mixes || []).map((m: any) => ({
        ...m, rank: rankMix++,
        thumbnailUrl: results.find(r => r.videoId === m.videoId)?.thumbnailUrl || '',
      }));
      const newVideos = (classified.videos || []).map((v: any) => ({
        ...v, rank: rankVideo++,
        thumbnailUrl: results.find(r => r.videoId === v.videoId)?.thumbnailUrl || '',
      }));
      const newArtists = (classified.artists || []).map((a: any) => ({
        ...a, rank: rankArtist++, artistId: null,
      }));

      classifiedMixes = [...classifiedMixes, ...newMixes];
      classifiedVideos = [...classifiedVideos, ...newVideos];
      classifiedArtists = [...classifiedArtists, ...newArtists];

      // Persist new non-song items to youtube_items (fire-and-forget)
      const itemsToSave = [
        ...newMixes.map(m => ({ videoId: m.videoId, type: 'mix', title: m.title, thumbnailUrl: m.thumbnailUrl })),
        ...newVideos.map(v => ({ videoId: v.videoId, type: 'video', title: v.title, thumbnailUrl: v.thumbnailUrl })),
        ...newArtists.map(a => ({ videoId: unknownForGemini.find(r => r.channelTitle === a.name)?.videoId, type: 'artist', title: a.name, thumbnailUrl: '' })),
      ].filter(item => item.videoId);

      Promise.all(
        itemsToSave.map(item =>
          this.firestore.doc(`youtube_items/${item.videoId}`).set({ ...item, seenAt: new Date() })
        )
      ).catch(err => this.logger.warn(`Failed to save youtube_items: ${err.message}`));

      // Handle classified songs from Gemini
      const geminiSongs = classified.songs || [];
      const knownClassifiedSongs = geminiSongs.filter((s: any) => knownSongsMap.has(s.videoId));
      const unknownClassifiedSongs = geminiSongs.filter((s: any) => !knownSongsMap.has(s.videoId));

      this.logger.log(
        `Gemini classified ${geminiSongs.length} songs — ${knownClassifiedSongs.length} already in DB, ${unknownClassifiedSongs.length} new`
      );

      // Add known songs to songRefs immediately (no Last.fm needed)
      for (const song of knownClassifiedSongs) {
        const known = knownSongsMap.get(song.videoId);
        if (known && !seenDbIds.has(known.id)) {
          seenDbIds.add(known.id);
          songRefs.push({ songId: known.id, rank: rankCounter++, videoId: song.videoId, title: known.title, artistName: known.artistName });
        }
      }

      // Process unknown songs: dedup + Last.fm enrichment
      if (unknownClassifiedSongs.length > 0) {
        // Step A: check song_duplicates cache
        const dedupChecks = await Promise.all(
          unknownClassifiedSongs.map(s => this.dedup.getCanonicalSongId(s.videoId))
        );
        const trulyUnknown = unknownClassifiedSongs.filter((_, i) => !dedupChecks[i]);
        const knownDuplicates = unknownClassifiedSongs.filter((_, i) => !!dedupChecks[i]);

        for (let i = 0; i < unknownClassifiedSongs.length; i++) {
          const canonicalId = dedupChecks[i];
          if (canonicalId && !seenDbIds.has(canonicalId)) {
            seenDbIds.add(canonicalId);
            const s = unknownClassifiedSongs[i];
            songRefs.push({ songId: canonicalId, rank: rankCounter++, videoId: s.videoId, title: s.title, artistName: s.artistName });
          }
        }

        if (knownDuplicates.length > 0) {
          this.logger.log(`Skipped ${knownDuplicates.length} known duplicates from song_duplicates cache`);
        }

        if (trulyUnknown.length > 0) {
          // Step B: code-based dedup
          const dedupInput = trulyUnknown.map(s => ({
            videoId: s.videoId,
            title: s.title,
            artistName: s.artistName,
            durationSeconds: results.find(r => r.videoId === s.videoId)?.durationSeconds,
          }));
          const { unique: dedupedUnknown, duplicateMap } = this.dedup.deduplicateByCode(dedupInput);

          for (const [removedId, keptId] of duplicateMap.entries()) {
            this.dedup.recordDistinct(removedId, keptId, 'code_dedup_kept_shorter').catch(() => {});
          }

          this.logger.log(
            `Code dedup: ${trulyUnknown.length} → ${dedupedUnknown.length} (removed ${duplicateMap.size} duplicates)`
          );

          // Step C: parallel Last.fm enrichment
          if (dedupedUnknown.length > 0) {
            this.logger.log(`Enriching ${dedupedUnknown.length} new songs with Last.fm (parallel)`);
            const metadataResults = await Promise.all(
              dedupedUnknown.map(song => this.lastfm.searchTrack(song.title, song.artistName))
            );

            await Promise.all(
              dedupedUnknown.map(async (song, i) => {
                const original = results.find(r => r.videoId === song.videoId);
                const classifiedSong = unknownClassifiedSongs.find(s => s.videoId === song.videoId);
                const metadata = metadataResults[i];
                const allGenres = [...new Set([...(classifiedSong?.genres || []), ...(metadata?.tags || [])])].slice(0, 5);

                const songData: any = {
                  title: song.title,
                  videoTitle: original?.title || song.title,
                  artistName: song.artistName,
                  youtubeId: song.videoId,
                  nameLower: song.title.toLowerCase(),
                  coverImageUrl: metadata?.albumArt || original?.thumbnailUrl || '',
                  durationSeconds: original?.durationSeconds || 0,
                  genres: allGenres,
                  listeners: metadata?.listeners || 0,
                  tags: metadata?.rawTags || [],
                  searchTokens: this.generateSearchTokens(song.title + ' ' + song.artistName),
                  createdAt: new Date(),
                  updatedAt: new Date(),
                };

                // Only add optional fields if they exist
                if (metadata?.album) songData.album = metadata.album;
                if (metadata?.releaseDate) songData.releaseDate = metadata.releaseDate;
                if (metadata?.mbid) songData.mbid = metadata.mbid;

                const docRef = await this.firestore.collection('songs').add(songData);
                if (!seenDbIds.has(docRef.id)) {
                  seenDbIds.add(docRef.id);
                  songRefs.push({ songId: docRef.id, rank: rankCounter++, videoId: song.videoId, title: song.title, artistName: song.artistName });

                  const dupeVideoIds = [...duplicateMap.entries()]
                    .filter(([, keptId]) => keptId === song.videoId)
                    .map(([removedId]) => removedId);
                  for (const dupeId of dupeVideoIds) {
                    this.dedup.recordDuplicate(dupeId, docRef.id, song.videoId).catch(() => {});
                  }
                }
              })
            );
          }
        }
      }
    } else {
      // All results are already known — add known songs directly to songRefs
      for (const result of results) {
        const known = knownSongsMap.get(result.videoId);
        if (known && !seenDbIds.has(known.id)) {
          seenDbIds.add(known.id);
          songRefs.push({ songId: known.id, rank: rankCounter++, videoId: result.videoId, title: known.title, artistName: known.artistName });
        }
      }
    }

    // Save to search cache
    const searchData = {
      query: dto.query,
      normalizedQuery,
      variations: [dto.query.toLowerCase()],
      songs: songRefs.map(s => ({
        youtubeId: s.videoId,
        rank: s.rank,
        songId: s.songId,
        title: s.title,
        artistName: s.artistName,
      })),
      mixes: classifiedMixes,
      videos: classifiedVideos,
      artists: classifiedArtists,
      searchCount: 1,
      lastSearched: new Date(),
      lastUpdated: new Date(),
      createdAt: new Date(),
    };

    await this.firestore.doc(`youtube_searches/${normalizedQuery}`).set(searchData);

    // Update in-memory cache in background
    this.updateSearchesCache(dto.query, 1, new Date());

    const result = await this.enrichSearchResults(searchData);

    // Apply intent-based post-filtering on enriched songs
    if (intentFilter && result.songs.length > 0) {
      this.logger.log(`Applying intent filter: ${JSON.stringify(intentFilter)}`);
      result.songs = result.songs.filter((song: any) => {
        if (intentFilter.genre) {
          const songGenres = [...(song.genres || []), song.genre].filter(Boolean).map((g: string) => g.toLowerCase());
          if (!songGenres.some(g => g.includes(intentFilter.genre!.toLowerCase()))) return false;
        }
        if (intentFilter.tags?.length) {
          const songTags = (song.tags || []).map((t: string) => t.toLowerCase());
          if (!intentFilter.tags.some(tag => songTags.includes(tag.toLowerCase()))) return false;
        }
        return true;
      });
      result.songs = result.songs.map((s: any, i: number) => ({ ...s, rank: i + 1 }));
    }

    // Populate memory cache
    const memCacheKey = `yt_search:${normalizedQuery}`;
    await this.cache.set(memCacheKey, result, 300_000);
    return result;
  }

  private async findSimilarSearch(query: string): Promise<any> {
    const queryLower = query.toLowerCase();
    this.logger.log(`Searching for similar queries to: "${queryLower}"`);

    const snapshot = await this.firestore.collection('youtube_searches')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    this.logger.log(`Found ${snapshot.size} cached searches to compare`);

    let bestMatch = null;
    let bestSimilarity = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const variations = data.variations || [data.query?.toLowerCase()];

      for (const variation of variations) {
        if (!variation) continue;

        const similarity = this.calculateSimilarity(queryLower, variation);

        this.logger.debug(`Comparing "${queryLower}" vs "${variation}": ${Math.round(similarity * 100)}%`);

        if (similarity > bestSimilarity && similarity >= 0.85) {
          bestSimilarity = similarity;
          bestMatch = doc;
        }
      }
    }

    if (bestMatch) {
      this.logger.log(`✓ Found similar search: "${query}" matched "${bestMatch.data().query}" (${Math.round(bestSimilarity * 100)}% similar)`);
    } else {
      this.logger.log(`✗ No similar search found for "${query}"`);
    }

    return bestMatch;
  }

  private normalizeSearchQuery(query: string): string {
    return query
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/^(el|la|los|las|the)\s+/i, '') // Remove leading articles
      .replace(/\s+(el|la|los|las|the)\s+/gi, ' ') // Remove articles in middle
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '-');
  }

  private normalizeArtistName(artist: string): string {
    return artist
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/^(el|la|los|las|the)\s+/i, '')
      .replace(/\s+de\s+/gi, ' ')
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private calculateSimilarity(str1: string, str2: string): number {
    const bigrams1 = this.getBigrams(str1);
    const bigrams2 = this.getBigrams(str2);

    const intersection = bigrams1.filter(b => bigrams2.includes(b)).length;
    return (2 * intersection) / (bigrams1.length + bigrams2.length);
  }

  private getBigrams(str: string): string[] {
    const bigrams = [];
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.push(str.substring(i, i + 2));
    }
    return bigrams;
  }

  async getTrendingMusic(country: string = 'EC', limit: number = 50, force: boolean = false): Promise<SearchYouTubeResponseDto> {
    const maxLimit = 50;
    const memCacheKey = `trending_v2_${country}`;

    // Track this country for scheduled refresh
    await this.firestore.doc(`trending_countries/${country}`).set({
      lastRequested: new Date(),
      requestCount: admin.firestore.FieldValue.increment(1),
    }, { merge: true });

    // 1. In-memory cache (fastest — no network)
    if (!force) {
      const memCached = await this.cache.get<SearchYouTubeResponseDto>(memCacheKey);
      if (memCached) {
        this.logger.log(`Memory cache hit for trending ${country}`);
        return {
          songs: memCached.songs.slice(0, limit),
          mixes: memCached.mixes.slice(0, limit),
          videos: memCached.videos.slice(0, limit),
          artists: memCached.artists.slice(0, limit),
        };
      }
    }

    // 2. Firestore cache (survives restarts, shared across instances)
    const firestoreCacheRef = this.firestore.doc(`trending_cache_v2/${country}`);
    if (!force) {
      const firestoreCached = await firestoreCacheRef.get();
      if (firestoreCached.exists) {
        const data = firestoreCached.data();
        const lastUpdated = data.lastUpdated?.toDate();
        const isStale = !lastUpdated || (Date.now() - lastUpdated.getTime()) > 60 * 60 * 1000; // 1h

        if (!isStale) {
          this.logger.log(`Firestore cache hit for trending ${country}`);
          const result = data.result as SearchYouTubeResponseDto;
          await this.cache.set(memCacheKey, result, 3600000); // 1h in-memory
          return {
            songs: result.songs.slice(0, limit),
            mixes: result.mixes.slice(0, limit),
            videos: result.videos.slice(0, limit),
            artists: result.artists.slice(0, limit),
          };
        }

        // Stale — return old data immediately, refresh in background
        this.logger.log(`Stale Firestore cache for trending ${country} — returning stale, refreshing in background`);
        const staleResult = data.result as SearchYouTubeResponseDto;
        await this.cache.set(memCacheKey, staleResult, 3600000); // 1h in-memory
        this.refreshTrendingCache(country, maxLimit).catch(err =>
          this.logger.error(`Background trending refresh failed for ${country}: ${err.message}`)
        );
        return {
          songs: staleResult.songs.slice(0, limit),
          mixes: staleResult.mixes.slice(0, limit),
          videos: staleResult.videos.slice(0, limit),
          artists: staleResult.artists.slice(0, limit),
        };
      }
    }

    // 3. No cache or force refresh — fetch fresh
    this.logger.log(`Fetching fresh trending for ${country}${force ? ' (forced)' : ''}`);
    const result = await this.refreshTrendingCache(country, maxLimit);
    return {
      songs: result.songs.slice(0, limit),
      mixes: result.mixes.slice(0, limit),
      videos: result.videos.slice(0, limit),
      artists: result.artists.slice(0, limit),
    };
  }

  private async refreshTrendingCache(country: string, maxLimit: number): Promise<SearchYouTubeResponseDto> {
    this.logger.log(`Fetching trending music for ${country} from YouTube`);

    const trendingVideos = await this.youtube.getTrendingVideos(country, maxLimit);

    // Batch-check known songs and items in parallel
    const allVideoIds = trendingVideos.map(r => r.videoId);
    const idChunks = this.chunkArray(allVideoIds, 10);

    const [knownSongSnapshots, knownItemSnapshots] = await Promise.all([
      Promise.all(idChunks.map(chunk =>
        this.firestore.collection('songs').where('youtubeId', 'in', chunk).get()
      )),
      Promise.all(idChunks.map(chunk =>
        this.firestore.collection('youtube_items').where('videoId', 'in', chunk).get()
      )),
    ]);

    const knownSongsMap = new Map<string, any>();
    for (const snapshot of knownSongSnapshots) {
      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.youtubeId) knownSongsMap.set(data.youtubeId, { id: doc.id, ...data });
      }
    }

    const knownItemsMap = new Map<string, any>();
    for (const snapshot of knownItemSnapshots) {
      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.videoId) knownItemsMap.set(data.videoId, data);
      }
    }

    const unknownForGemini = trendingVideos.filter(
      r => !knownSongsMap.has(r.videoId) && !knownItemsMap.has(r.videoId)
    );

    this.logger.log(
      `Trending ${country}: ${trendingVideos.length} videos — ${knownSongsMap.size} known songs, ` +
      `${knownItemsMap.size} known items, ${unknownForGemini.length} need Gemini`
    );

    // Build result from known items
    let classifiedMixes: any[] = [];
    let classifiedVideos: any[] = [];
    let classifiedArtists: any[] = [];
    const songRefs: Array<any> = [];
    const seenDbIds = new Set<string>();
    let rankCounter = 1;
    let rankMix = 1, rankVideo = 1, rankArtist = 1;

    for (const video of trendingVideos) {
      const item = knownItemsMap.get(video.videoId);
      if (!item) continue;
      const entry = { title: item.title, videoId: video.videoId, thumbnailUrl: video.thumbnailUrl || item.thumbnailUrl || '' };
      if (item.type === 'mix') classifiedMixes.push({ ...entry, rank: rankMix++ });
      else if (item.type === 'video') classifiedVideos.push({ ...entry, rank: rankVideo++ });
      else if (item.type === 'artist') classifiedArtists.push({ name: item.title, rank: rankArtist++, artistId: null });
    }

    // Add known songs directly
    for (const video of trendingVideos) {
      const known = knownSongsMap.get(video.videoId);
      if (known && !seenDbIds.has(known.id)) {
        seenDbIds.add(known.id);
        songRefs.push({
          songId: known.id,
          rank: rankCounter++,
          videoId: video.videoId,
          title: known.title,
          artistName: known.artistName,
        });
      }
    }

    // Classify and enrich unknown videos via Gemini + Last.fm
    if (unknownForGemini.length > 0) {
      const prompt = `Classify YouTube trending music videos into: songs, mixes, videos, artists.
Rules:
- Songs: Single tracks. Clean title (remove: Official Video, Lyrics, Audio, VEVO). Extract artist. Assign 1-3 music genres.
- Mixes: Playlists, compilations, DJ sets
- Videos: Interviews, behind-scenes, live performances
- Artists: Artist channels

Return JSON only:
{
  "songs": [{"title":"Song","artistName":"Artist","videoId":"abc","genres":["genre1"]}],
  "mixes": [{"title":"Mix","videoId":"xyz"}],
  "videos": [{"title":"Video","videoId":"def"}],
  "artists": [{"name":"Artist"}]
}

Input: ${JSON.stringify(unknownForGemini.map(r => ({ videoId: r.videoId, title: r.title, channel: r.channelTitle, duration: r.durationSeconds })))}`;

      const text = await this.gemini.generate(prompt);
      const classified = JSON.parse(this.extractJson(text));

      // Merge non-song items
      const newMixes = (classified.mixes || []).map((m: any) => ({
        ...m, rank: rankMix++,
        thumbnailUrl: trendingVideos.find(r => r.videoId === m.videoId)?.thumbnailUrl || '',
      }));
      const newVideos = (classified.videos || []).map((v: any) => ({
        ...v, rank: rankVideo++,
        thumbnailUrl: trendingVideos.find(r => r.videoId === v.videoId)?.thumbnailUrl || '',
      }));
      const newArtists = (classified.artists || []).map((a: any) => ({
        ...a, rank: rankArtist++, artistId: null,
      }));

      classifiedMixes = [...classifiedMixes, ...newMixes];
      classifiedVideos = [...classifiedVideos, ...newVideos];
      classifiedArtists = [...classifiedArtists, ...newArtists];

      // Persist new non-song items
      const itemsToSave = [
        ...newMixes.map(m => ({ videoId: m.videoId, type: 'mix', title: m.title, thumbnailUrl: m.thumbnailUrl })),
        ...newVideos.map(v => ({ videoId: v.videoId, type: 'video', title: v.title, thumbnailUrl: v.thumbnailUrl })),
      ].filter(item => item.videoId);

      Promise.all(
        itemsToSave.map(item =>
          this.firestore.doc(`youtube_items/${item.videoId}`).set({ ...item, seenAt: new Date() })
        )
      ).catch(() => {});

      // Enrich new songs with Last.fm and save to songs collection
      const newSongs: any[] = classified.songs || [];
      if (newSongs.length > 0) {
        this.logger.log(`Enriching ${newSongs.length} trending songs with Last.fm (parallel)`);
        const metadataResults = await Promise.all(
          newSongs.map(song => this.lastfm.searchTrack(song.title, song.artistName))
        );

        await Promise.all(
          newSongs.map(async (song, i) => {
            const original = trendingVideos.find(r => r.videoId === song.videoId);
            const metadata = metadataResults[i];
            const allGenres = [...new Set([...(song.genres || []), ...(metadata?.tags || [])])].slice(0, 5);

            const songData: any = {
              title: song.title,
              videoTitle: original?.title || song.title,
              artistName: song.artistName,
              youtubeId: song.videoId,
              nameLower: song.title.toLowerCase(),
              coverImageUrl: metadata?.albumArt || original?.thumbnailUrl || '',
              durationSeconds: original?.durationSeconds || 0,
              genres: allGenres,
              listeners: metadata?.listeners || 0,
              tags: metadata?.rawTags || [],
              searchTokens: this.generateSearchTokens(song.title + ' ' + song.artistName),
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            // Only add optional fields if they exist
            if (metadata?.album) songData.album = metadata.album;
            if (metadata?.releaseDate) songData.releaseDate = metadata.releaseDate;
            if (metadata?.mbid) songData.mbid = metadata.mbid;

            const docRef = await this.firestore.collection('songs').add(songData);
            if (!seenDbIds.has(docRef.id)) {
              seenDbIds.add(docRef.id);
              songRefs.push({ songId: docRef.id, rank: rankCounter++, videoId: song.videoId, title: song.title, artistName: song.artistName });
            }
          })
        );
      }
    }

    // Enrich songRefs with full song data for response
    const enrichedSongs = await Promise.all(
      songRefs.map(async s => {
        if (s.songId) {
          const doc = await this.firestore.doc(`songs/${s.songId}`).get();
          if (doc.exists) {
            const data = doc.data();
            const song: any = {
              id: doc.id,
              title: data.title,
              artistName: data.artistName,
              youtubeId: s.videoId,
              thumbnailUrl: data.coverImageUrl || '',
              duration: data.durationSeconds || 0,
              rank: s.rank,
              genres: data.genres || [],
              tags: data.tags || [],
              listeners: data.listeners || 0,
            };
            // Only add optional fields if they exist
            if (data.album) song.album = data.album;
            if (data.releaseDate) song.releaseDate = data.releaseDate;
            if (data.mbid) song.mbid = data.mbid;
            return song;
          }
        }
        return { ...s, genres: [], tags: [], listeners: 0 };
      })
    );

    const result: SearchYouTubeResponseDto = {
      songs: enrichedSongs,
      mixes: classifiedMixes,
      videos: classifiedVideos,
      artists: classifiedArtists,
    };

    // Persist to Firestore cache (survives restarts)
    await this.firestore.doc(`trending_cache_v2/${country}`).set({
      result,
      lastUpdated: new Date(),
    });

    // Populate in-memory cache
    await this.cache.set(`trending_v2_${country}`, result, 3600000); // 1h

    return result;
  }

  async generatePlaylist(songId: string, limit: number = 30, search?: string): Promise<SearchSongDto[]> {
    const normalizedSearch = search?.trim()
      ? search.toLowerCase().trim().replace(/\s+/g, '_')
      : null;
    const cacheKey = normalizedSearch
      ? `playlists_generated/${songId}_${normalizedSearch}`
      : `playlists_generated/${songId}`;

    const playlistDoc = await this.firestore.doc(cacheKey).get();

    if (playlistDoc.exists) {
      const data = playlistDoc.data();
      const lastUpdated = data.lastUpdated?.toDate();
      const isStale = !lastUpdated || (Date.now() - lastUpdated.getTime()) > 7 * 24 * 60 * 60 * 1000;

      if (!isStale) {
        this.logger.log(`Returning saved playlist for song ${songId}`);
        const songIds = data.songs.slice(0, limit);
        const songs = await Promise.all(
          songIds.map(async (id: string) => {
            const doc = await this.firestore.doc(`songs/${id}`).get();
            if (doc.exists) {
              return this.mapToSongResponse(doc.id, doc.data());
            }
            return null;
          })
        );
        return songs.filter(s => s !== null);
      }
    }

    const seedDoc = await this.firestore.doc(`songs/${songId}`).get();
    if (!seedDoc.exists) {
      throw new NotFoundException('Song not found');
    }

    const seedSong = seedDoc.data();
    this.logger.log(`Generating playlist based on: ${seedSong.title} by ${seedSong.artistName}`);

    const playlist: SearchSongDto[] = [];
    const seenIds = new Set<string>([songId]);

    // Get artist's best songs from YouTube using artistName from Firestore (no extra API call)
    const relatedVideos = await this.youtube.getRelatedVideos(seedSong.artistName, limit * 2);
    
    // Clean and classify with Gemini
    const searchContext = normalizedSearch
      ? `The user searched for: "${search!.trim()}". Prioritize songs that match this mood, vibe, and intent.\n\n`
      : '';
    const prompt = `${searchContext}Classify YouTube results into: songs, mixes, videos, artists.
Rules:
- Songs: Single tracks. Clean title (remove: Official Video, Lyrics, Audio, VEVO). Extract artist. Assign 1-3 music genres.
- Mixes: Playlists, compilations, DJ sets
- Videos: Interviews, behind-scenes, live performances
- Remove duplicates

Return JSON:
{
  "songs": [{"title":"Song","artistName":"Artist","videoId":"abc","genres":["genre1"]}],
  "mixes": [{"title":"Mix","videoId":"xyz"}],
  "videos": [{"title":"Video","videoId":"def"}],
  "artists": [{"name":"Artist"}]
}

Input: ${JSON.stringify(relatedVideos.map(r => ({ videoId: r.videoId, title: r.title, channel: r.channelTitle, duration: r.durationSeconds })))}`;

    let classified: { songs: any[] };
    try {
      const text = await this.gemini.generate(prompt);
      classified = JSON.parse(this.extractJson(text));
    } catch (err) {
      this.logger.warn(`Gemini classification failed for playlist, using heuristic fallback: ${err.message}`);
      classified = { songs: relatedVideos.filter(r => !this.isMixOrVideo(r.title, r.durationSeconds)).map(r => ({
        title: r.title,
        artistName: r.channelTitle,
        videoId: r.videoId,
        genres: [],
      })) };
    }

    // Process songs
    for (const song of classified.songs || []) {
      if (playlist.length >= limit) break;
      if (!song.videoId) continue;

      const original = relatedVideos.find(r => r.videoId === song.videoId);
      
      // Check if song exists
      const existingSnapshot = await this.firestore.collection('songs')
        .where('youtubeId', '==', song.videoId)
        .limit(1)
        .get();

      if (!existingSnapshot.empty && !seenIds.has(existingSnapshot.docs[0].id)) {
        const doc = existingSnapshot.docs[0];
        seenIds.add(doc.id);
        playlist.push(this.mapToSongResponse(doc.id, doc.data(), playlist.length + 1));
      } else if (existingSnapshot.empty) {
        // Create new song
        const metadata = await this.lastfm.searchTrack(song.title, song.artistName);
        const geminiGenres = song.genres || [];
        const lastfmGenres = metadata?.tags || [];
        const allGenres = [...new Set([...geminiGenres, ...lastfmGenres])].slice(0, 5);

        const songData: any = {
          title: song.title,
          videoTitle: original?.title || song.title,
          artistName: song.artistName,
          youtubeId: song.videoId,
          nameLower: song.title.toLowerCase(),
          coverImageUrl: metadata?.albumArt || original?.thumbnailUrl || '',
          durationSeconds: original?.durationSeconds || 0,
          genres: allGenres,
          listeners: metadata?.listeners || 0,
          tags: metadata?.rawTags || [],
          searchTokens: this.generateSearchTokens(song.title + ' ' + song.artistName),
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        // Only add optional fields if they exist
        if (metadata?.album) songData.album = metadata.album;
        if (metadata?.releaseDate) songData.releaseDate = metadata.releaseDate;
        if (metadata?.mbid) songData.mbid = metadata.mbid;

        const docRef = await this.firestore.collection('songs').add(songData);
        seenIds.add(docRef.id);
        playlist.push(this.mapToSongResponse(docRef.id, songData, playlist.length + 1));
      }
    }

    this.logger.log(`Generated playlist with ${playlist.length} songs from YouTube related videos`);

    await this.firestore.doc(cacheKey).set({
      songs: playlist.map(s => s.id).filter(Boolean),
      generatedAt: playlistDoc.exists ? playlistDoc.data().generatedAt : new Date(),
      lastUpdated: new Date(),
    });

    return playlist;
  }

  async refreshMetadata(songId: string): Promise<{ success: boolean; message: string }> {
    const doc = await this.firestore.doc(`songs/${songId}`).get();
    if (!doc.exists) {
      throw new NotFoundException('Song not found');
    }

    const song = doc.data();
    const metadata = await this.lastfm.searchTrack(song.title, song.artistName);

    if (!metadata) {
      return { success: false, message: 'No metadata found on Last.fm' };
    }

    const genres = metadata.tags || [];

    await this.firestore.doc(`songs/${songId}`).update({
      genres,
      tags: metadata.tags || [],
      album: metadata.album || null,
      listeners: metadata.listeners || 0,
      mbid: metadata.mbid || null,
      coverImageUrl: metadata.albumArt || song.coverImageUrl,
      updatedAt: new Date(),
    });

    this.logger.log(`Refreshed metadata for song ${songId}: genres=${genres.length}, tags=${metadata.tags?.length || 0}`);
    return { success: true, message: `Updated with ${genres.length} genres, ${metadata.tags?.length || 0} tags` };
  }

  async backfillVideoTitles(): Promise<{ processed: number; skipped: number; failed: number }> {
    this.logger.log('Starting videoTitle backfill for songs missing the field');

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let lastDoc: any = null;
    const batchSize = 50;

    // Process in batches to avoid memory issues
    while (true) {
      let query = this.firestore
        .collection('songs')
        .orderBy('createdAt')
        .limit(batchSize);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();
      if (snapshot.empty) break;

      lastDoc = snapshot.docs[snapshot.docs.length - 1];

      // Filter to only songs missing videoTitle
      const needsUpdate = snapshot.docs.filter(doc => {
        const data = doc.data();
        return !data.videoTitle && data.youtubeId;
      });

      if (needsUpdate.length === 0) {
        skipped += snapshot.docs.length;
        if (snapshot.docs.length < batchSize) break;
        continue;
      }

      // Batch-fetch YouTube titles for all songs in this batch
      const videoIds = needsUpdate.map(doc => doc.data().youtubeId).join(',');
      try {
        const response = await this.youtube.getVideoTitles(videoIds);

        await Promise.all(
          needsUpdate.map(async doc => {
            const data = doc.data();
            const videoTitle = response[data.youtubeId];
            if (videoTitle) {
              await this.firestore.doc(`songs/${doc.id}`).update({ videoTitle });
              processed++;
            } else {
              // No YouTube data — use existing title as fallback
              await this.firestore.doc(`songs/${doc.id}`).update({ videoTitle: data.title });
              processed++;
            }
          })
        );
      } catch (error) {
        this.logger.error(`Batch failed: ${(error as Error).message}`);
        failed += needsUpdate.length;
      }

      skipped += snapshot.docs.length - needsUpdate.length;

      if (snapshot.docs.length < batchSize) break;
    }

    this.logger.log(`videoTitle backfill complete — processed: ${processed}, skipped: ${skipped}, failed: ${failed}`);
    return { processed, skipped, failed };
  }

  private mapToSongResponse(id: string, data: any, rank: number = 0): SearchSongDto {
    return {
      id,
      title: data.title,
      artistName: data.artistName,
      youtubeId: data.youtubeId,
      thumbnailUrl: data.coverImageUrl,
      duration: data.durationSeconds,
      rank,
      artistId: data.artistId,
      albumId: data.albumId,
      genres: data.genres || [],
      tags: data.tags || [],
      album: data.album,
      releaseDate: data.releaseDate,
      listeners: data.listeners,
      mbid: data.mbid,
      ...this.resolveStreamUrl(data),
    };
  }

  private isMixOrVideo(title: string, durationSeconds: number = 0): boolean {
    const t = title.toLowerCase();
    const mixKeywords = /\b(mix|playlist|compilation|megamix|nonstop|non-stop|mashup|medley|vol\.|best of|greatest hits|top \d|hits)\b/;
    const videoKeywords = /\b(interview|behind the scenes|making of|live|concert|tour|reaction|review|acoustic|unplugged|documentary|trailer)\b/;
    return mixKeywords.test(t) || videoKeywords.test(t) || durationSeconds > 20 * 60;
  }

  private resolveStreamUrl(data: SongDocument): { streamUrl: string | null; streamUrlExpiresAt: string | null } {
    if (!data.streamUrl || !data.streamUrlExpiresAt) return { streamUrl: null, streamUrlExpiresAt: null };
    const expiresAt = data.streamUrlExpiresAt.toDate();
    if (expiresAt <= new Date()) return { streamUrl: null, streamUrlExpiresAt: null };
    return { streamUrl: data.streamUrl, streamUrlExpiresAt: expiresAt.toISOString() };
  }

  async saveStreamUrl(id: string, streamUrl: string, expiresAt: Date): Promise<void> {
    const doc = await this.firestore.doc(`songs/${id}`).get();
    if (!doc.exists) throw new NotFoundException('Song not found');

    await this.firestore.doc(`songs/${id}`).update({ streamUrl, streamUrlExpiresAt: expiresAt });
    await this.cache.del(CacheKeys.song(id));
  }

  async saveMixStreamUrl(youtubeId: string, streamUrl: string, expiresAt: Date): Promise<void> {
    await this.firestore.doc(`mixes/${youtubeId}`).set({ streamUrl, streamUrlExpiresAt: expiresAt }, { merge: true });
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
              duration: songData.durationSeconds,
              rank: s.rank,
              artistId: songData.artistId,
              albumId: songData.albumId,
              genres: songData.genres || [],
              tags: songData.tags || [],
              album: songData.album,
              releaseDate: songData.releaseDate,
              listeners: songData.listeners,
              mbid: songData.mbid,
              ...this.resolveStreamUrl(songData as SongDocument),
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

    const mixYoutubeIds: string[] = (data.mixes || []).map((m) => m.youtubeId).filter(Boolean);
    const mixDocs = await Promise.all(mixYoutubeIds.map((id) => this.firestore.doc(`mixes/${id}`).get()));
    const mixStreamUrls: Record<string, { streamUrl: string | null; streamUrlExpiresAt: string | null }> = {};
    for (const doc of mixDocs) {
      if (doc.exists) {
        const d = doc.data()!;
        const expiresAt: Date = d.streamUrlExpiresAt?.toDate?.();
        mixStreamUrls[doc.id] = expiresAt && expiresAt > new Date()
          ? { streamUrl: d.streamUrl, streamUrlExpiresAt: expiresAt.toISOString() }
          : { streamUrl: null, streamUrlExpiresAt: null };
      }
    }

    return {
      songs,
      mixes: (data.mixes || []).map((m) => ({
        ...m,
        genres: m.genres || [],
        ...(mixStreamUrls[m.youtubeId] ?? { streamUrl: null, streamUrlExpiresAt: null }),
      })),
      videos: data.videos || [],
      artists,
    };
  }
}
