import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FirestoreService } from '../firestore/firestore.service';
import { SongsService } from './songs.service';
import { GeminiService } from '../sync/gemini.service';

interface BackfillConfig {
  enabled: boolean;
  lastRun?: Date;
  lastRunSummary?: RunSummary;
}

interface SongPhaseResult {
  processed: number;
  skipped: number;
  failed: number;
}

interface MixPhaseResult {
  documentsUpdated: number;
  entriesEnriched: number;
}

interface RunSummary {
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  songPhase: SongPhaseResult;
  mixPhase: MixPhaseResult;
}

@Injectable()
export class MetadataBackfillScheduler implements OnModuleInit {
  private readonly logger = new Logger(MetadataBackfillScheduler.name);
  private isRunning = false;

  constructor(
    private readonly firestore: FirestoreService,
    private readonly songsService: SongsService,
    private readonly gemini: GeminiService,
  ) {}

  onModuleInit(): void {
    this.logger.log(
      'MetadataBackfillScheduler initialized — cron: 4AM daily, batchSize: 50, maxSongs: 500, maxMixDocs: 20',
    );
  }

  private async readBackfillConfig(): Promise<BackfillConfig> {
    const doc = await this.firestore.doc('app_config/metadata_backfill').get();
    if (!doc.exists) {
      return { enabled: true };
    }
    const data = doc.data() as BackfillConfig;
    return { enabled: data.enabled ?? true };
  }

  private async writeRunSummary(summary: RunSummary): Promise<void> {
    await this.firestore.doc('app_config/metadata_backfill').set(
      {
        lastRun: summary.completedAt,
        lastRunSummary: summary,
      },
      { merge: true },
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async runSongMetadataPhase(): Promise<SongPhaseResult> {
    const BATCH_SIZE = 50;
    const MAX_SONGS = 500;
    const RATE_LIMIT_MS = 200;

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let totalProcessed = 0;
    let lastDoc: any = null;

    while (true) {
      if (totalProcessed >= MAX_SONGS) {
        this.logger.log(`Song metadata phase: cap of ${MAX_SONGS} reached`);
        break;
      }

      let query = this.firestore
        .collection('songs')
        .orderBy('createdAt', 'asc')
        .limit(BATCH_SIZE);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();

      if (snapshot.empty) {
        break;
      }

      lastDoc = snapshot.docs[snapshot.docs.length - 1];

      for (const doc of snapshot.docs) {
        const data = doc.data();
        const hasMissingMetadata =
          !data.genres || data.genres.length === 0 ||
          !data.tags || data.tags.length === 0 ||
          !data.album ||
          !data.coverImageUrl ||
          !data.listeners ||
          !data.mbid;

        if (!hasMissingMetadata) {
          skipped++;
          continue;
        }

        if (totalProcessed >= MAX_SONGS) {
          break;
        }

        try {
          await this.songsService.refreshMetadata(doc.id);
          processed++;
          totalProcessed++;
        } catch (err) {
          this.logger.error(`Song metadata phase: error with song ID ${doc.id}`, err);
          failed++;
        }

        await this.delay(RATE_LIMIT_MS);
      }

      this.logger.log(
        `Song metadata phase batch summary: processed=${processed}, skipped=${skipped}, failed=${failed}`,
      );

      if (snapshot.docs.length < BATCH_SIZE) {
        break;
      }
    }

    if (processed === 0 && failed === 0) {
      await this.firestore.doc('app_config/metadata_backfill').update({ enabled: false });
      this.logger.log('Song metadata phase: auto-cancel triggered — no songs needed updating');
    }

    this.logger.log(
      `Song metadata phase complete: processed=${processed}, skipped=${skipped}, failed=${failed}`,
    );

    return { processed, skipped, failed };
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

  private async runMixGenresPhase(): Promise<MixPhaseResult> {
    const MAX_DOCS = 20;
    const GEMINI_RATE_LIMIT_MS = 5000;

    let documentsUpdated = 0;
    let entriesEnriched = 0;

    const snapshot = await this.firestore
      .collection('youtube_searches')
      .limit(MAX_DOCS)
      .get();

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const mixes: any[] = data.mixes ?? [];

      const staleMixes = mixes.filter(
        (entry) => !entry.genres || entry.genres.length === 0,
      );

      if (staleMixes.length === 0) {
        continue;
      }

      const inputJson = JSON.stringify(
        staleMixes.map((m) => ({ youtubeId: m.youtubeId, title: m.title })),
      );

      const prompt =
        `Classify the genres for these YouTube mix/playlist titles. Return ONLY a JSON array where each element has { "youtubeId": "<videoId>", "genres": ["genre1", "genre2"] } with 1-3 genre strings per mix.\n` +
        `Input: ${inputJson}`;

      let parsed: { youtubeId: string; genres: string[] }[];
      try {
        const response = await this.gemini.generate(prompt);
        parsed = JSON.parse(this.extractJson(response));
      } catch (err) {
        this.logger.error(
          `Mix genres phase: failed to parse Gemini response for doc ${doc.id}`,
          err,
        );
        await this.delay(GEMINI_RATE_LIMIT_MS);
        continue;
      }

      const updatedMixes = mixes.map((entry) => {
        const match = parsed.find((p) => p.youtubeId === entry.youtubeId);
        if (match) {
          return { ...entry, genres: match.genres };
        }
        return entry;
      });

      await doc.ref.update({ mixes: updatedMixes });

      documentsUpdated++;
      entriesEnriched += parsed.length;

      await this.delay(GEMINI_RATE_LIMIT_MS);
    }

    this.logger.log(
      `Mix genres phase complete: documentsUpdated=${documentsUpdated}, entriesEnriched=${entriesEnriched}`,
    );

    return { documentsUpdated, entriesEnriched };
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async runBackfill(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('MetadataBackfillScheduler already running, skipping this trigger');
      return;
    }

    this.isRunning = true;
    const startedAt = new Date();
    this.logger.log(`MetadataBackfillScheduler started at ${startedAt.toISOString()}`);

    try {
      const config = await this.readBackfillConfig();
      if (config.enabled === false) {
        this.logger.log('MetadataBackfillScheduler is disabled — skipping run');
        return;
      }

      const songPhase = await this.runSongMetadataPhase();
      const mixPhase = await this.runMixGenresPhase();

      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();

      const summary: RunSummary = {
        startedAt,
        completedAt,
        durationMs,
        songPhase,
        mixPhase,
      };

      await this.writeRunSummary(summary);

      this.logger.log(
        `MetadataBackfillScheduler completed in ${durationMs}ms — ` +
          `songs: processed=${songPhase.processed}, skipped=${songPhase.skipped}, failed=${songPhase.failed}; ` +
          `mixes: documentsUpdated=${mixPhase.documentsUpdated}, entriesEnriched=${mixPhase.entriesEnriched}`,
      );
    } finally {
      this.isRunning = false;
    }
  }
}
