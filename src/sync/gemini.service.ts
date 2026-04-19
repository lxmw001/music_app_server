import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import {
  GeminiArtistResult,
  YouTubeSearchResult,
  RawYouTubeResult,
  CleanedSongResult,
} from './interfaces/sync.interfaces';

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly genAI: GoogleGenAI | null;
  private readonly modelName = 'gemini-3.1-flash-lite-preview';

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.genAI = new GoogleGenAI({ apiKey });
    } else {
      this.logger.warn('GEMINI_API_KEY not set — Gemini features will use fallbacks');
      this.genAI = null;
    }
  }

  private lastCallTime = 0;

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async callWithRateLimit<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const timeSinceLastCall = now - this.lastCallTime;
    const minDelay = 5000;
    
    if (timeSinceLastCall < minDelay) {
      const waitTime = minDelay - timeSinceLastCall;
      this.logger.debug(`Rate limiting: waiting ${waitTime}ms`);
      await this.delay(waitTime);
    }
    
    this.lastCallTime = Date.now();
    return fn();
  }

  async generate(prompt: string): Promise<string> {
    if (!this.genAI) throw new Error('Gemini API not initialized');
    
    const model = this.genAI.getGenerativeModel({ model: this.modelName });
    const result = await this.callWithRateLimit(() => 
      model.generateContent(prompt)
    );
    
    return result.response.text();
  }

  async getPopularGenres(country?: string): Promise<string[]> {
    try {
      const countryContext = country ? ` most listened to in ${country}` : '';
      const prompt = `List the 10 most popular music genres${countryContext} based on streaming and radio play. Include both local and international genres that people actually listen to. Return ONLY a JSON array of strings, no explanation. Example: ["Reggaeton","Pop","Vallenato"]`;
      const text = await this.generate(prompt);
      const parsed = JSON.parse(this.extractJson(text));
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter((g) => typeof g === 'string' && g.length > 0);
      }
      return this.defaultGenres();
    } catch (error) {
      this.logger.warn(`getPopularGenres failed: ${(error as Error).message}`);
      return this.defaultGenres();
    }
  }

  private defaultGenres(): string[] {
    return ['Rock', 'Pop', 'Hip-Hop', 'Jazz', 'Classical', 'R&B', 'Electronic', 'Country'];
  }

  async getArtistsForGenre(genre: string, country?: string): Promise<GeminiArtistResult[]> {
    try {
      const countryContext = country ? ` most searched and streamed in ${country}` : '';
      const prompt = `List the top 20${countryContext} ${genre} artists based on streaming platforms, radio play, and search trends. Return ONLY a JSON array with objects having fields: name (string), rank (number 1-20, unique), topSongs (array of up to 10 song title strings). Example: [{"name":"Artist","rank":1,"topSongs":["Song1","Song2","Song3"]}]`;
      const text = await this.generate(prompt);
      const parsed: GeminiArtistResult[] = JSON.parse(this.extractJson(text));

      if (!Array.isArray(parsed) || parsed.length === 0) {
        return this.defaultArtists(genre);
      }

      const seen = new Set<number>();
      const deduped: GeminiArtistResult[] = [];
      for (const artist of parsed) {
        if (!seen.has(artist.rank)) {
          seen.add(artist.rank);
          deduped.push(artist);
        }
      }
      return deduped.sort((a, b) => a.rank - b.rank);
    } catch (error) {
      this.logger.warn(`getArtistsForGenre(${genre}) failed: ${(error as Error).message}`);
      return this.defaultArtists(genre);
    }
  }

  private defaultArtists(genre: string): GeminiArtistResult[] {
    this.logger.warn(`Using empty artist list fallback for genre: ${genre}`);
    return [];
  }

  async generateSearchQueries(artistName: string, topSongs?: string[]): Promise<string[]> {
    try {
      const songsHint = topSongs && topSongs.length > 0 ? ` Known songs: ${topSongs.join(', ')}.` : '';
      const prompt = `Generate 3-5 YouTube search queries to find music videos for the artist "${artistName}".${songsHint} Return ONLY a JSON array of query strings. Example: ["${artistName} official music video","${artistName} best songs"]`;
      const text = await this.generate(prompt);
      const parsed: string[] = JSON.parse(this.extractJson(text));

      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter((q) => typeof q === 'string' && q.length > 0);
      }
      return this.buildDefaultQueries(artistName, topSongs);
    } catch (error) {
      this.logger.warn(`generateSearchQueries(${artistName}) failed: ${(error as Error).message}`);
      return this.buildDefaultQueries(artistName, topSongs);
    }
  }

  private buildDefaultQueries(artistName: string, topSongs?: string[]): string[] {
    const queries = [`${artistName} official music video`, `${artistName} best songs`];
    if (topSongs) {
      for (const song of topSongs.slice(0, 3)) {
        queries.push(`${artistName} ${song}`);
      }
    }
    return queries;
  }

  async cleanAndDeduplicate(rawResults: RawYouTubeResult[], country?: string): Promise<CleanedSongResult[]> {
    if (rawResults.length === 0) return [];

    try {
      const countryContext = country ? ` Popular search terms in ${country} should be prioritized.` : '';
      const prompt = `You are a music data cleaner. Given these raw YouTube search results, normalize song titles (remove suffixes like "(Official Video)", "(Lyrics)", "(ft. ...)", fix casing), normalize artist names (consistent casing, remove featuring info), and deduplicate (same title+artist = one entry, keep best youtubeId). 

IMPORTANT: For each song, generate 3-5 relevant search tags that users would commonly search for. Tags should include:
- Genre/subgenre (e.g., "reggaeton", "vallenato", "pop latino")
- Mood/vibe (e.g., "romantic", "party", "sad", "energetic")  
- Era/year if relevant (e.g., "2024", "90s", "classic")
- Common search patterns (e.g., "para bailar", "para dedicar", "workout music")${countryContext}

Return ONLY a JSON array of objects with fields: title, artistName, genre, artistRank, youtubeId, thumbnailUrl, durationSeconds (optional), tags (array of 3-5 strings). 

Input: ${JSON.stringify(rawResults.slice(0, 50))}`;
      const text = await this.generate(prompt);
      const parsed: CleanedSongResult[] = JSON.parse(this.extractJson(text));

      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter((r) => r.title && r.artistName && r.youtubeId);
      }
      return this.basicClean(rawResults);
    } catch (error) {
      this.logger.warn(`cleanAndDeduplicate failed: ${(error as Error).message}`);
      return this.basicClean(rawResults);
    }
  }

  private basicClean(rawResults: RawYouTubeResult[]): CleanedSongResult[] {
    const seen = new Map<string, CleanedSongResult>();
    for (const r of rawResults) {
      const title = this.normalizeTitle(r.title);
      const artistName = this.normalizeArtist(r.artistName);
      const key = `${title.toLowerCase()}|${artistName.toLowerCase()}`;
      if (!seen.has(key)) {
        seen.set(key, {
          title,
          artistName,
          genre: r.genre,
          artistRank: r.artistRank,
          youtubeId: r.videoId,
          thumbnailUrl: r.thumbnailUrl,
          durationSeconds: r.durationSeconds,
        });
      }
    }
    return Array.from(seen.values());
  }

  private normalizeTitle(title: string): string {
    return title
      .replace(/\s*\(official\s*(music\s*)?video\)/gi, '')
      .replace(/\s*\(lyrics?\)/gi, '')
      .replace(/\s*\(ft\..*?\)/gi, '')
      .replace(/\s*\(feat\..*?\)/gi, '')
      .replace(/\s*\[.*?\]/g, '')
      .trim();
  }

  private normalizeArtist(name: string): string {
    return name
      .replace(/\s*ft\..*$/i, '')
      .replace(/\s*feat\..*$/i, '')
      .trim();
  }

  async rankAndDisambiguate(
    results: YouTubeSearchResult[],
    context: { title: string; artistName: string; genre: string },
  ): Promise<string> {
    if (results.length === 0) return '';
    if (results.length === 1) return results[0].videoId;

    try {
      const prompt = `Given these YouTube search results for the song "${context.title}" by "${context.artistName}" (genre: ${context.genre}), return ONLY the videoId string of the best matching official music video. Results: ${JSON.stringify(results.slice(0, 10))}`;
      const videoId = (await this.generate(prompt)).trim().replace(/['"]/g, '');

      const valid = results.find((r) => r.videoId === videoId);
      return valid ? videoId : results[0].videoId;
    } catch (error) {
      this.logger.warn(`rankAndDisambiguate failed: ${(error as Error).message}`);
      return results[0].videoId;
    }
  }

  private extractJson(text: string): string {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return match[1].trim();
    
    const start = text.search(/[\[{]/);
    const end = text.lastIndexOf(text[start] === '[' ? ']' : '}');
    
    if (start !== -1 && end !== -1 && end > start) {
      return text.slice(start, end + 1);
    }
    
    if (start !== -1) return text.slice(start);
    return text;
  }

  async aiSearch(query: string, searchFunction: (params: any) => Promise<any>): Promise<any> {
    try {
      const results = await searchFunction({ query });
      
      if (this.genAI && results.length > 0) {
        const prompt = `User searched for: "${query}". Found ${results.length} songs. Generate a brief, friendly response (1-2 sentences) describing what was found.`;
        const text = await this.generate(prompt);
        
        return { results, aiResponse: text };
      }
      
      return { results, aiResponse: `Found ${results.length} songs matching "${query}"` };
    } catch (error) {
      this.logger.error(`AI search failed: ${(error as Error).message}`);
      const results = await searchFunction({ query });
      return { results, aiResponse: `Found ${results.length} results` };
    }
  }
}
