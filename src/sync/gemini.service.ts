import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  GeminiArtistResult,
  YouTubeSearchResult,
  RawYouTubeResult,
  CleanedSongResult,
} from './interfaces/sync.interfaces';

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly genAI: GoogleGenerativeAI | null;
  private readonly modelName = 'gemini-1.5-flash';

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
    } else {
      this.logger.warn('GEMINI_API_KEY not set — Gemini features will use fallbacks');
      this.genAI = null;
    }
  }

  private getModel() {
    if (!this.genAI) return null;
    return this.genAI.getGenerativeModel({ model: this.modelName });
  }

  async getPopularGenres(): Promise<string[]> {
    try {
      const model = this.getModel();
      if (!model) return this.defaultGenres();

      const prompt =
        'List 10 popular music genres. Return ONLY a JSON array of strings, no explanation. Example: ["Rock","Pop","Hip-Hop"]';
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
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

  async getArtistsForGenre(genre: string): Promise<GeminiArtistResult[]> {
    try {
      const model = this.getModel();
      if (!model) return this.defaultArtists(genre);

      const prompt = `List the top 5 most popular ${genre} artists. Return ONLY a JSON array with objects having fields: name (string), rank (number 1-5, unique), topSongs (array of up to 3 song title strings). Example: [{"name":"Artist","rank":1,"topSongs":["Song1","Song2"]}]`;
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      const parsed: GeminiArtistResult[] = JSON.parse(this.extractJson(text));

      if (!Array.isArray(parsed) || parsed.length === 0) {
        return this.defaultArtists(genre);
      }

      // Ensure unique ranks
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
      const model = this.getModel();
      if (!model) return this.buildDefaultQueries(artistName, topSongs);

      const songsHint = topSongs && topSongs.length > 0 ? ` Known songs: ${topSongs.join(', ')}.` : '';
      const prompt = `Generate 3-5 YouTube search queries to find music videos for the artist "${artistName}".${songsHint} Return ONLY a JSON array of query strings. Example: ["${artistName} official music video","${artistName} best songs"]`;
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
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

  async cleanAndDeduplicate(rawResults: RawYouTubeResult[]): Promise<CleanedSongResult[]> {
    if (rawResults.length === 0) return [];

    try {
      const model = this.getModel();
      if (!model) return this.basicClean(rawResults);

      const prompt = `You are a music data cleaner. Given these raw YouTube search results, normalize song titles (remove suffixes like "(Official Video)", "(Lyrics)", "(ft. ...)", fix casing), normalize artist names (consistent casing, remove featuring info), and deduplicate (same title+artist = one entry, keep best youtubeId). Return ONLY a JSON array of objects with fields: title, artistName, genre, artistRank, youtubeId, durationSeconds (optional). Input: ${JSON.stringify(rawResults.slice(0, 50))}`;

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
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
      const model = this.getModel();
      if (!model) return results[0].videoId;

      const prompt = `Given these YouTube search results for the song "${context.title}" by "${context.artistName}" (genre: ${context.genre}), return ONLY the videoId string of the best matching official music video. Results: ${JSON.stringify(results.slice(0, 10))}`;
      const result = await model.generateContent(prompt);
      const videoId = result.response.text().trim().replace(/['"]/g, '');

      const valid = results.find((r) => r.videoId === videoId);
      return valid ? videoId : results[0].videoId;
    } catch (error) {
      this.logger.warn(`rankAndDisambiguate failed: ${(error as Error).message}`);
      return results[0].videoId;
    }
  }

  private extractJson(text: string): string {
    // Strip markdown code fences if present
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return match[1].trim();
    // Find first [ or { to start of JSON
    const start = text.search(/[\[{]/);
    if (start !== -1) return text.slice(start);
    return text;
  }
}
