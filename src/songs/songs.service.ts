import { Inject, Injectable, NotFoundException, Logger } from '@nestjs/common';
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
    private readonly lastfm: LastFmService,
    private readonly dedup: SongDeduplicationService,
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
      artistName: data.artistName,
      albumId: data.albumId,
      durationSeconds: data.durationSeconds,
      coverImageUrl: data.coverImageUrl,
      youtubeId: data.youtubeId,
      genre: data.genre,
      tags: data.tags,
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
        artistName: data.artistName,
        albumId: data.albumId,
        durationSeconds: data.durationSeconds,
        coverImageUrl: data.coverImageUrl,
        youtubeId: data.youtubeId,
        genre: data.genre,
        tags: data.tags,
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

                const songData = {
                  title: song.title,
                  artistName: song.artistName,
                  youtubeId: song.videoId,
                  nameLower: song.title.toLowerCase(),
                  coverImageUrl: metadata?.albumArt || original?.thumbnailUrl || '',
                  durationSeconds: original?.durationSeconds || 0,
                  album: metadata?.album || null,
                  releaseDate: metadata?.releaseDate || null,
                  genres: allGenres,
                  listeners: metadata?.listeners || 0,
                  mbid: metadata?.mbid || null,
                  tags: metadata?.rawTags || [],
                  searchTokens: this.generateSearchTokens(song.title + ' ' + song.artistName),
                  createdAt: new Date(),
                  updatedAt: new Date(),
                };

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
      .replace(/[\u0300-\u036f]/g, '')
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

  async getTrendingMusic(country: string = 'EC', limit: number = 50): Promise<SearchYouTubeResponseDto> {
    const maxLimit = 50;
    const cacheKey = `trending_${country}`;

    const cached = await this.cache.get<SearchYouTubeResponseDto>(cacheKey);
    if (cached) {
      this.logger.log(`Returning cached trending music for ${country}`);
      return {
        songs: cached.songs.slice(0, limit),
        mixes: cached.mixes.slice(0, limit),
        videos: cached.videos.slice(0, limit),
        artists: cached.artists.slice(0, limit),
      };
    }

    this.logger.log(`Getting trending music for ${country} from YouTube`);

    const trendingVideos = await this.youtube.getTrendingVideos(country, maxLimit);

    const prompt = `Classify YouTube trending music videos into: songs, mixes, videos, artists.
Rules:
- Songs: Single tracks. Clean title (remove: Official Video, Lyrics, Audio, VEVO). Extract artist.
- Mixes: Playlists, compilations, DJ sets
- Videos: Interviews, behind-scenes, live performances
- Artists: Artist channels
- IMPORTANT: Remove duplicates - if same song appears multiple times:
  * Recognize artist name variations
  * Keep the version with shortest duration (avoids intros/outros)
  * Use the shortest/cleanest artist name format

Return JSON:
{
  "songs": [{"title":"Song","artistName":"Artist","videoId":"abc"}],
  "mixes": [{"title":"Mix","videoId":"xyz"}],
  "videos": [{"title":"Video","videoId":"def"}],
  "artists": [{"name":"Artist"}]
}

Input: ${JSON.stringify(trendingVideos.map(r => ({ videoId: r.videoId, title: r.title, channel: r.channelTitle, duration: r.durationSeconds })))}`;

    const text = await this.gemini.generate(prompt);
    const classified = JSON.parse(this.extractJson(text));

    // Deduplicate songs
    const seenSongs = new Map<string, any>();
    const uniqueSongs = [];
    for (const song of classified.songs || []) {
      const key = `${song.title.toLowerCase()}-${this.normalizeArtistName(song.artistName)}`;
      const existing = seenSongs.get(key);
      const currentDuration = trendingVideos.find(r => r.videoId === song.videoId)?.durationSeconds || 999999;

      if (!existing) {
        seenSongs.set(key, { song, duration: currentDuration });
        uniqueSongs.push(song);
      } else if (currentDuration < existing.duration) {
        const index = uniqueSongs.indexOf(existing.song);
        uniqueSongs[index] = song;
        seenSongs.set(key, { song, duration: currentDuration });
      }
    }

    const songs = uniqueSongs.map((song, index) => {
      const video = trendingVideos.find(v => v.videoId === song.videoId);
      return {
        title: song.title,
        artistName: song.artistName,
        youtubeId: song.videoId,
        thumbnailUrl: video?.thumbnailUrl || '',
        duration: video?.durationSeconds || 0,
        rank: index + 1,
        genres: [],
        tags: [],
      };
    });

    const result = {
      songs,
      mixes: (classified.mixes || []).map((m, i) => ({
        ...m,
        rank: i + 1,
        thumbnailUrl: trendingVideos.find(r => r.videoId === m.videoId)?.thumbnailUrl || '',
      })),
      videos: (classified.videos || []).map((v, i) => ({
        ...v,
        rank: i + 1,
        thumbnailUrl: trendingVideos.find(r => r.videoId === v.videoId)?.thumbnailUrl || '',
      })),
      artists: (classified.artists || []).map((a, i) => ({
        ...a,
        rank: i + 1,
      })),
    };

    // Cache for 6 hours
    await this.cache.set(cacheKey, result, 21600000);
    return result;
  }

  async generatePlaylist(songId: string, limit: number = 30): Promise<SearchSongDto[]> {
    const playlistDoc = await this.firestore.doc(`playlists_generated/${songId}`).get();

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

    const similarTracks = await this.lastfm.getSimilarTracks(
      seedSong.title,
      seedSong.artistName,
      limit * 2
    );

    for (const track of similarTracks) {
      if (playlist.length >= limit) break;

      const snapshot = await this.firestore.collection('songs')
        .where('nameLower', '==', track.title.toLowerCase())
        .limit(5)
        .get();

      for (const doc of snapshot.docs) {
        const songData = doc.data();
        const artistMatch = this.normalizeArtistName(songData.artistName) ===
                           this.normalizeArtistName(track.artist);

        if (artistMatch && !seenIds.has(doc.id)) {
          playlist.push(this.mapToSongResponse(doc.id, songData, playlist.length + 1));
          seenIds.add(doc.id);
          break;
        }
      }
    }

    this.logger.log(`Matched ${playlist.length} songs from Last.fm recommendations`);

    if (playlist.length < limit) {
      const needed = limit - playlist.length;
      const tags = seedSong.tags || [];
      const genre = seedSong.genre;

      let query = this.firestore.collection('songs').limit(needed * 2);

      if (tags.length > 0) {
        query = query.where('tags', 'array-contains-any', tags.slice(0, 10));
      } else if (genre) {
        query = query.where('genre', '==', genre);
      }

      const snapshot = await query.get();

      for (const doc of snapshot.docs) {
        if (playlist.length >= limit) break;
        if (!seenIds.has(doc.id)) {
          playlist.push(this.mapToSongResponse(doc.id, doc.data(), playlist.length + 1));
          seenIds.add(doc.id);
        }
      }

      this.logger.log(`Added ${playlist.length - similarTracks.length} songs from DB fallback`);
    }

    await this.firestore.doc(`playlists_generated/${songId}`).set({
      songs: playlist.map(s => s.id),
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
    };
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
