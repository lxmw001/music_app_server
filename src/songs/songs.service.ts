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
import { SubmitSearchDto } from './dto/submit-search.dto';
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
    const normalizedQuery = this.normalizeSearchQuery(dto.query);

    // 1. Check in-memory cache first (5 min TTL) — fastest path
    const memCacheKey = `yt_search:${normalizedQuery}`;
    const memCached = await this.cache.get<SearchYouTubeResponseDto>(memCacheKey);
    if (memCached) {
      this.logger.log(`Memory cache hit for "${dto.query}"`);
      return memCached;
    }

    // 2. Check Firestore exact match
    let cached = await this.firestore.doc(`youtube_searches/${normalizedQuery}`).get();

    // 3. If no exact match, try fuzzy search — but run it async so it doesn't block
    //    We only wait for it if we truly have no cache at all
    if (!cached.exists) {
      const fuzzyMatch = await this.findSimilarSearch(dto.query);
      if (fuzzyMatch) {
        cached = fuzzyMatch;
        // Fire-and-forget: register variation without blocking response
        this.firestore.doc(`youtube_searches/${fuzzyMatch.id}`).update({
          variations: admin.firestore.FieldValue.arrayUnion(dto.query.toLowerCase()),
        }).catch(() => {});
      }
    }

    if (cached.exists) {
      const data = cached.data();
      const lastUpdated = data.lastUpdated?.toDate();
      const isStale = !lastUpdated || (Date.now() - lastUpdated.getTime()) > 7 * 24 * 60 * 60 * 1000;

      // Fire-and-forget: increment search count without blocking
      this.firestore.doc(`youtube_searches/${cached.id}`).update({
        searchCount: (data.searchCount || 0) + 1,
        lastSearched: new Date(),
      }).catch(() => {});

      if (!isStale) {
        const result = await this.enrichSearchResults(data);
        // Populate memory cache
        await this.cache.set(memCacheKey, result, 300_000); // 5 min
        return result;
      }

      // Stale-while-revalidate: return stale data immediately, refresh in background
      this.logger.log(`Stale cache for "${dto.query}" — returning stale, refreshing in background`);
      const staleResult = await this.enrichSearchResults(data);
      await this.cache.set(memCacheKey, staleResult, 300_000);
      // Background refresh — don't await
      this.refreshSearchCache(dto, normalizedQuery).catch(err =>
        this.logger.error(`Background refresh failed for "${dto.query}": ${err.message}`)
      );
      return staleResult;
    }
    
    // Delegate to shared method used by both fresh fetch and background refresh
    return this.refreshSearchCache(dto, normalizedQuery);
  }

  private async refreshSearchCache(dto: SearchYouTubeDto, normalizedQuery: string): Promise<SearchYouTubeResponseDto> {
    // YouTube search
    const results = await this.youtube.searchVideos(dto.query, 20);

    // --- OPTIMIZATION: check which videoIds are already in Firestore ---
    // Batch query by youtubeId (exact match, no Gemini/Last.fm needed for known songs)
    const allVideoIds = results.map(r => r.videoId);
    const knownSongsMap = new Map<string, any>(); // videoId → song doc data

    const idChunks = this.chunkArray(allVideoIds, 10); // Firestore `in` max = 10
    const knownSnapshots = await Promise.all(
      idChunks.map(chunk =>
        this.firestore.collection('songs').where('youtubeId', 'in', chunk).get()
      )
    );
    for (const snapshot of knownSnapshots) {
      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.youtubeId) {
          knownSongsMap.set(data.youtubeId, { id: doc.id, ...data });
        }
      }
    }

    const unknownResults = results.filter(r => !knownSongsMap.has(r.videoId));
    this.logger.log(
      `YouTube search: ${results.length} results — ${knownSongsMap.size} already in DB, ${unknownResults.length} new`
    );

    // Build songRefs for known songs immediately (no Gemini/Last.fm needed)
    const songRefs: Array<any> = [];
    const seenDbIds = new Set<string>();
    let rankCounter = 1;

    for (const result of results) {
      const known = knownSongsMap.get(result.videoId);
      if (known && !seenDbIds.has(known.id)) {
        seenDbIds.add(known.id);
        songRefs.push({
          songId: known.id,
          rank: rankCounter++,
          videoId: result.videoId,
          title: known.title,
          artistName: known.artistName,
        });
      }
    }

    // Only call Gemini if there are unknown results
    let classifiedMixes: any[] = [];
    let classifiedVideos: any[] = [];
    let classifiedArtists: any[] = [];

    if (unknownResults.length > 0) {
      // --- Step A: check song_duplicates for unknown videoIds ---
      // Some unknowns may already be recorded as duplicates of existing songs
      const dedupChecks = await Promise.all(
        unknownResults.map(r => this.dedup.getCanonicalSongId(r.videoId))
      );
      const trulyUnknown = unknownResults.filter((_, i) => !dedupChecks[i]);
      const knownDuplicates = unknownResults.filter((_, i) => !!dedupChecks[i]);

      for (let i = 0; i < unknownResults.length; i++) {
        const canonicalId = dedupChecks[i];
        if (canonicalId && !seenDbIds.has(canonicalId)) {
          seenDbIds.add(canonicalId);
          const r = unknownResults[i];
          songRefs.push({ songId: canonicalId, rank: rankCounter++, videoId: r.videoId, title: r.title, artistName: r.channelTitle });
        }
      }

      if (knownDuplicates.length > 0) {
        this.logger.log(`Skipped ${knownDuplicates.length} known duplicates from song_duplicates cache`);
      }

      if (trulyUnknown.length > 0) {
        // --- Step B: code-based dedup before sending to Gemini ---
        const dedupInput = trulyUnknown.map(r => ({
          videoId: r.videoId,
          title: r.title,
          artistName: r.channelTitle,
          durationSeconds: r.durationSeconds,
        }));
        const { unique: dedupedUnknown, duplicateMap } = this.dedup.deduplicateByCode(dedupInput);

        // Persist code-detected duplicates to song_distinct/song_duplicates async
        for (const [removedId, keptId] of duplicateMap.entries()) {
          this.dedup.recordDistinct(removedId, keptId, 'code_dedup_kept_shorter').catch(() => {});
        }

        this.logger.log(
          `Code dedup: ${trulyUnknown.length} → ${dedupedUnknown.length} (removed ${duplicateMap.size} duplicates)`
        );

        // --- Step C: Gemini classification (no dedup instruction needed) ---
        const prompt = `Classify YouTube music results into: songs, mixes, videos, artists.
Rules:
- Songs: Single music tracks. Clean title (remove: Official Video, Lyrics, Audio, VEVO). Extract artist name. Assign 1-3 music genres.
- Mixes: Playlists, compilations, DJ sets, "Best of" collections.
- Videos: Interviews, behind-the-scenes, live performances (not music videos).
- Artists: Artist channels or profiles.

Return JSON only:
{
  "songs": [{"title":"Clean Title","artistName":"Artist","videoId":"abc","genres":["genre1"]}],
  "mixes": [{"title":"Mix Title","videoId":"xyz"}],
  "videos": [{"title":"Video Title","videoId":"def"}],
  "artists": [{"name":"Artist Name"}]
}

Input: ${JSON.stringify(dedupedUnknown.map(r => ({ videoId: r.videoId, title: r.title, channel: r.artistName, duration: r.durationSeconds })))}`;

        const text = await this.gemini.generate(prompt);
        const classified = JSON.parse(this.extractJson(text));

        classifiedMixes = classified.mixes || [];
        classifiedVideos = classified.videos || [];
        classifiedArtists = classified.artists || [];

        const classifiedSongs: any[] = classified.songs || [];

        // --- Step D: parallel Last.fm enrichment for new songs only ---
        if (classifiedSongs.length > 0) {
          this.logger.log(`Enriching ${classifiedSongs.length} new songs with Last.fm (parallel)`);
          const metadataResults = await Promise.all(
            classifiedSongs.map(song => this.lastfm.searchTrack(song.title, song.artistName))
          );

          await Promise.all(
            classifiedSongs.map(async (song, i) => {
              const original = trulyUnknown.find(r => r.videoId === song.videoId);
              const metadata = metadataResults[i];
              const allGenres = [...new Set([...(song.genres || []), ...(metadata?.tags || [])])].slice(0, 5);

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

                // Record code-detected duplicates pointing to this new song
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
    
    // Save to search cache (only references)
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
      mixes: classifiedMixes.map((m, i) => ({
        ...m,
        rank: i + 1,
        thumbnailUrl: results.find(r => r.videoId === m.videoId)?.thumbnailUrl || '',
      })),
      videos: classifiedVideos.map((v, i) => ({
        ...v,
        rank: i + 1,
        thumbnailUrl: results.find(r => r.videoId === v.videoId)?.thumbnailUrl || '',
      })),
      artists: classifiedArtists.map((a, i) => ({
        ...a,
        rank: i + 1,
        artistId: null,
      })),
      searchCount: 1,
      lastSearched: new Date(),
      lastUpdated: new Date(),
      createdAt: new Date(),
    };
    
    await this.firestore.doc(`youtube_searches/${normalizedQuery}`).set(searchData);

    const result = await this.enrichSearchResults(searchData);
    // Populate memory cache
    const memCacheKey = `yt_search:${normalizedQuery}`;
    await this.cache.set(memCacheKey, result, 300_000);
    return result;
  }

  private async findSimilarSearch(query: string): Promise<any> {
    const queryLower = query.toLowerCase();
    this.logger.log(`Searching for similar queries to: "${queryLower}"`);
    
    // Get recent searches (limit 100 for performance)
    // Use createdAt as fallback if lastSearched doesn't exist
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
      
      // Check similarity with all variations
      for (const variation of variations) {
        if (!variation) continue;
        
        const similarity = this.calculateSimilarity(queryLower, variation);
        
        this.logger.debug(`Comparing "${queryLower}" vs "${variation}": ${Math.round(similarity * 100)}%`);
        
        if (similarity > bestSimilarity && similarity >= 0.85) { // 85% similarity threshold
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
      .normalize('NFD') // Decompose accents
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/[^\w\s]/g, '') // Remove special chars
      .replace(/\s+/g, '-'); // Replace spaces with dash
  }

  private normalizeArtistName(artist: string): string {
    return artist
      .toLowerCase()
      .normalize('NFD') // Decompose accents
      .replace(/[\u0300-\u036f]/g, '') // Remove accents (América → America)
      .replace(/^(el|la|los|las|the)\s+/i, '') // Remove articles
      .replace(/\s+de\s+/gi, ' ') // Remove "de" (Binomio de Oro → Binomio Oro)
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private calculateSimilarity(str1: string, str2: string): number {
    // Simple Dice coefficient for fuzzy matching
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
    // Always use max limit for cache (slice later)
    const maxLimit = 50;
    const cacheKey = `trending_${country}`;
    
    // Check cache (24 hour TTL)
    const cached = await this.cache.get<SearchYouTubeResponseDto>(cacheKey);
    if (cached) {
      this.logger.log(`Returning cached trending music for ${country}`);
      // Slice to requested limit
      return {
        songs: cached.songs.slice(0, limit),
        mixes: cached.mixes.slice(0, limit),
        videos: cached.videos.slice(0, limit),
        artists: cached.artists.slice(0, limit),
      };
    }

    this.logger.log(`Getting trending music for ${country} from YouTube`);

    // Get trending videos from YouTube
    const trendingVideos = await this.youtube.getTrendingVideos(country, maxLimit);

    // Clean with Gemini (same as search)
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

    // Map to response format
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

    // Cache for 6 hours (21600000 ms)
    await this.cache.set(cacheKey, result, 21600000);
    return result;
  }

  async generatePlaylist(songId: string, limit: number = 30): Promise<SearchSongDto[]> {
    // Check Firestore for saved playlist
    const playlistDoc = await this.firestore.doc(`playlists_generated/${songId}`).get();
    
    if (playlistDoc.exists) {
      const data = playlistDoc.data();
      const lastUpdated = data.lastUpdated?.toDate();
      const isStale = !lastUpdated || (Date.now() - lastUpdated.getTime()) > 7 * 24 * 60 * 60 * 1000; // 7 days
      
      if (!isStale) {
        this.logger.log(`Returning saved playlist for song ${songId}`);
        // Fetch full song data
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

    // Get the seed song
    const seedDoc = await this.firestore.doc(`songs/${songId}`).get();
    if (!seedDoc.exists) {
      throw new NotFoundException('Song not found');
    }

    const seedSong = seedDoc.data();
    this.logger.log(`Generating playlist based on: ${seedSong.title} by ${seedSong.artistName}`);

    const playlist: SearchSongDto[] = [];
    const seenIds = new Set<string>([songId]);

    // Use Last.fm Similar Tracks (no YouTube/Gemini needed)
    const similarTracks = await this.lastfm.getSimilarTracks(
      seedSong.title,
      seedSong.artistName,
      limit * 2
    );

    // Match Last.fm results with our DB
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

    // Fallback - Match by tags/genre from DB
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

    // Save to Firestore
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
