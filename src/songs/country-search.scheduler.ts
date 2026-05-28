import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FirestoreService } from '../firestore/firestore.service';
import { SongsService } from './songs.service';
import { GeminiService } from '../sync/gemini.service';

@Injectable()
export class CountrySearchScheduler {
  private readonly logger = new Logger(CountrySearchScheduler.name);
  private isRunning = false;

  constructor(
    private readonly firestore: FirestoreService,
    private readonly songsService: SongsService,
    private readonly gemini: GeminiService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async populateCountrySearches() {
    if (this.isRunning) {
      this.logger.warn('Country search population already running, skipping');
      return;
    }

    this.isRunning = true;
    this.logger.log('Starting country search population');

    try {
      const countriesSnapshot = await this.firestore.collection('trending_countries').get();
      const countries = countriesSnapshot.empty
        ? ['EC']
        : countriesSnapshot.docs.map(doc => doc.id);

      this.logger.log(`Processing countries: ${countries.join(', ')}`);

      for (const country of countries) {
        try {
          await this.processCountry(country);
        } catch (error) {
          this.logger.error(`Failed to process country ${country}: ${(error as Error).message}`);
        }
      }

      this.logger.log('Country search population completed');
    } catch (error) {
      this.logger.error(`Country search population failed: ${(error as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }

  private async processCountry(country: string): Promise<void> {
    const countryDoc = await this.firestore.doc(`trending_countries/${country}`).get();
    const searchesCount = countryDoc.data()?.searchesCount || 0;

    this.logger.log(`Processing ${country} — already collected ${searchesCount} queries`);

    const lang = this.countryLanguage(country);
    const prompt = `List 50 real music search queries that people in ${country} actually type into YouTube and Spotify.
All queries must be in ${lang}. Only include English queries if they are commonly used by ${country} listeners (e.g. international artists).
We already collected ${searchesCount} different queries in previous sessions. Give NEW ones not given before.
Today is ${new Date().toISOString().split('T')[0]}.
Return ONLY a JSON array of strings, no explanation.`;

    const text = await this.gemini.generate(prompt);
    const queries: string[] = JSON.parse(this.extractJson(text));

    if (!Array.isArray(queries) || queries.length === 0) {
      this.logger.warn(`Gemini returned no queries for ${country}`);
      return;
    }

    this.logger.log(`Gemini returned ${queries.length} queries for ${country}`);

    let newCount = 0;
    for (const query of queries) {
      if (!query || typeof query !== 'string') continue;

      const normalized = this.songsService.normalizeSearchQuery(query);
      const existing = await this.firestore.doc(`youtube_searches/${normalized}`).get();
      if (existing.exists) continue;

      try {
        this.logger.log(`Searching: "${query}" for ${country}`);
        await this.songsService.searchYouTube({ query });
        newCount++;
        await this.delay(5000);
      } catch (error) {
        this.logger.warn(`Failed to search "${query}": ${(error as Error).message}`);
      }
    }

    await this.firestore.doc(`trending_countries/${country}`).set({
      searchesCount: searchesCount + newCount,
      searchesUpdated: new Date(),
    }, { merge: true });

    this.logger.log(`✓ ${country}: added ${newCount} new searches (total: ${searchesCount + newCount})`);
  }

  private countryLanguage(country: string): string {
    const map: Record<string, string> = {
      EC: 'Spanish',
      MX: 'Spanish',
      ES: 'Spanish',
      AR: 'Spanish',
      CO: 'Spanish',
      CL: 'Spanish',
      PE: 'Spanish',
      VE: 'Spanish',
      US: 'English',
      GB: 'English',
      BR: 'Portuguese',
      PT: 'Portuguese',
      FR: 'French',
      DE: 'German',
      IT: 'Italian',
      JP: 'Japanese',
      KR: 'Korean',
      CN: 'Chinese',
      RU: 'Russian',
      IN: 'Hindi and English',
    };
    return map[country.toUpperCase()] || 'the local language';
  }

  private extractJson(text: string): string {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return match[1].trim();
    const start = text.search(/\[/);
    const end = text.lastIndexOf(']');
    if (start !== -1 && end !== -1 && end > start) return text.slice(start, end + 1);
    return text;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
