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
  private readonly modelName = 'gemini-3.1-flash-lite';

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
    
    const genAI = this.genAI;
    const result = await this.callWithRateLimit(() => 
      genAI.models.generateContent({
        model: this.modelName,
        contents: prompt,
      })
    );
    
    return result.text ?? '';
  }

  /**
   * Parse natural language search intent from a query.
   * Returns structured params if the query is natural language,
   * or null if it's a simple keyword/name query (skip Gemini).
   */
  async parseSearchIntent(query: string): Promise<{
    refinedQuery: string;
    genre?: string;
    mood?: string;
    artist?: string;
    year?: number;
    tags?: string[];
    isNaturalLanguage: boolean;
  } | null> {
    // Heuristic: skip Gemini for short simple queries (likely artist/song names)
    const words = query.trim().split(/\s+/);
    const naturalLanguageIndicators = [
      'songs', 'music', 'tracks', 'playlist', 'like', 'similar', 'for', 'when',
      'mood', 'feel', 'vibe', 'style', 'type', 'kind', 'genre', 'from', 'about',
      'workout', 'party', 'relax', 'sad', 'happy', 'upbeat', 'chill', 'romantic',
    ];
    const lowerQuery = query.toLowerCase();
    const looksNatural = words.length >= 3 ||
      naturalLanguageIndicators.some(w => lowerQuery.includes(w));

    if (!looksNatural || !this.genAI) return null;

    try {
      const prompt = `Analyze this music search query and extract structured intent.
Query: "${query}"

Return JSON only:
{
  "refinedQuery": "simplified search term for YouTube (artist name or song title)",
  "genre": "music genre if mentioned or implied (null if not)",
  "mood": "mood/vibe if mentioned (null if not)",
  "artist": "artist name if mentioned (null if not)",
  "year": null,
  "tags": ["relevant tags like 'workout', 'party', 'romantic' if implied"],
  "isNaturalLanguage": true/false
}

Examples:
- "bad bunny" → isNaturalLanguage: false, refinedQuery: "bad bunny"
- "sad reggaeton songs" → isNaturalLanguage: true, genre: "reggaeton", mood: "sad", refinedQuery: "reggaeton"
- "music for working out" → isNaturalLanguage: true, tags: ["workout"], refinedQuery: "workout music"`;

      const text = await this.generate(prompt);
      const parsed = JSON.parse(this.extractJson(text));
      return parsed;
    } catch {
      return null; // Fall back to regular search on any error
    }
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

  async generateVibeSearchQueries(params: {
    vibeId: string;
    subCategory?: string;
    birthYear?: number;
    genres?: string[];
    localTime?: string;
    dayOfWeek?: string;
  }): Promise<string[]> {
    const { vibeId, subCategory, birthYear, genres, localTime, dayOfWeek } = params;

    const age = birthYear ? new Date().getFullYear() - birthYear : null;
    const vibeLabel = subCategory ? `${vibeId} / ${subCategory}` : vibeId;
    const currentTime = localTime
      ? new Date(localTime).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false })
      : new Date().toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false });

    const prompt = `Actúa como un selector musical y DJ profesional con amplio conocimiento del mercado de entretenimiento en Ecuador. Tu objetivo es diseñar una estrategia de búsqueda y una playlist perfecta basándote estrictamente en las variables dinámicas proporcionadas por el sistema.

Variables del Sistema:
- Vibe / Subcategoría actual: ${vibeLabel}
- Edad del usuario: ${age ?? 'desconocida'} años
- Región de Ecuador: Sierra
- Hora actual del sistema: ${currentTime}

Instrucciones de Razonamiento Lógico (Aplica en este orden estricto):

1. FILTRO DE CONTEXTO TEMPORAL (La Hora):
Analiza la hora. Clasifica el momento en uno de estos estados:
- Mañana/Tarde (06:00 - 17:00): Ritmos enfocados en productividad, energía limpia, acompañamiento o activación moderada.
- Tarde/Noche (17:00 - 20:30): Transición, relajación posterior al trabajo, o recepción/cóctel si el vibe es de carácter social.
- Noche/Madrugada (20:30 - 05:00): Clímax de fiesta, desconexión total o relajación profunda para dormir, dependiendo estrictamente de la naturaleza del vibe.

2. FILTRO DE IDENTIDAD DEL VIBE Y DEMOGRAFÍA (La Edad):
Analiza el vibe. Determina si es un entorno COMPARTIDO/SOCIAL (ej: Fiestas, Eventos, Asados) o INDIVIDUAL (ej: Ejercicio, Concentración, Relax).
- Si es SOCIAL: Modera la influencia de la edad durante las primeras horas del evento para priorizar música multigeneracional. Activa el factor de edad al 100% en horarios avanzados de fiesta.
- Si es INDIVIDUAL: Prioriza al 100% los gustos generacionales. ${age ? `Calcula la "Época Dorada Musical" del usuario (cuando tenía entre 15 y 24 años, es decir ${age - 24}-${age - 15}) e inyecta éxitos nostálgicos de ese rango.` : ''}

3. FILTRO DE GEOLOCALIZACIÓN (La Región):
Región: Sierra (Ecuador). Adapta los matices hacia sonidos más andinos/orquestados cuando el vibe lo permita.

Entregables requeridos (responde SOLO con JSON válido, sin texto adicional):
{
  "searches": ["término 1", "término 2", ..., "término 10"]
}

Los 10 términos deben ser hiper-específicos para YouTube, optimizados para encontrar mixes largos o compilaciones.`;

    try {
      const text = await this.generate(prompt);
      const parsed = JSON.parse(this.extractJson(text));
      const searches: string[] = parsed.searches ?? parsed;
      if (Array.isArray(searches) && searches.length > 0) {
        return searches.filter(q => typeof q === 'string' && q.length > 0);
      }
    } catch (error) {
      this.logger.warn(`generateVibeSearchQueries failed: ${(error as Error).message}`);
    }

    return [`${vibeLabel} mix`, `${vibeLabel} playlist Ecuador`, `${vibeLabel} compilación`];
  }

  async generateVibeQueries(params: {
    vibeId: string;
    subCategory?: string;
    birthYear?: number;
    genres?: string[];
    localTime?: string;
    dayOfWeek?: string;
    limit?: number;
  }): Promise<{ title: string; artistName: string; youtubeId: string }[]> {
    const { vibeId, subCategory, birthYear, genres, localTime, dayOfWeek, limit = 10 } = params;

    const age = birthYear ? new Date().getFullYear() - birthYear : null;
    const ageDesc = age ? `una persona de ${age} años` : 'un usuario';
    const genreDesc = genres?.length ? `que le gusta ${genres.join(', ')}` : '';
    const timeDesc = localTime ? (() => {
      const h = new Date(localTime).getHours();
      if (h >= 6 && h < 10) return 'morning';
      if (h >= 10 && h < 18) return 'afternoon';
      if (h >= 18 && h < 22) return 'evening';
      return 'late night';
    })() : '';
    const contextDesc = [dayOfWeek, timeDesc].filter(Boolean).join(' ');
    const vibeLabel = subCategory ? `${vibeId} (${subCategory})` : vibeId;

    const prompt = `As a music expert, the user is ${ageDesc} ${genreDesc}. It's ${contextDesc}. They selected the "${vibeLabel}" vibe.${age ? ` Include some nostalgia from around ${birthYear! + 16}-${birthYear! + 26}.` : ''}
Suggest ${limit} real songs that fit this vibe. For each song provide the real YouTube video ID (the 11-character ID from youtube.com/watch?v=XXXXXXXXXXX).
Return ONLY a JSON array: [{"title":"Song Title","artistName":"Artist Name","youtubeId":"XXXXXXXXXXX"}]`;

    try {
      const text = await this.generate(prompt);
      const parsed: { title: string; artistName: string; youtubeId: string }[] = JSON.parse(this.extractJson(text));
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter(s => s.title && s.artistName && s.youtubeId?.length === 11);
      }
    } catch (error) {
      this.logger.warn(`generateVibeQueries failed: ${(error as Error).message}`);
    }

    return [];
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
