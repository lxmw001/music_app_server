import { Injectable, Logger } from '@nestjs/common';
import { FirestoreService } from '../firestore/firestore.service';

export interface DeduplicationResult {
  isDuplicate: boolean;
  canonicalSongId: string | null; // null = distinct (keep both)
}

/**
 * Manages two Firestore collections:
 *
 * song_duplicates/{videoId}
 *   canonicalSongId: string   — the "winner" song doc ID
 *   canonicalVideoId: string  — the winner's YouTube video ID
 *   detectedAt: Date
 *
 * song_distinct/{videoId_A}_{videoId_B}  (videoIds sorted alphabetically)
 *   videoIdA: string
 *   videoIdB: string
 *   reason: string
 *   confirmedAt: Date
 */
@Injectable()
export class SongDeduplicationService {
  private readonly logger = new Logger(SongDeduplicationService.name);

  // Patterns that indicate a sequel/part — these are DISTINCT songs even if titles are similar
  private readonly SEQUEL_PATTERNS = [
    /\s+2\s*$/i,           // "Song 2"
    /\s+ii\s*$/i,          // "Song II"
    /\s+iii\s*$/i,         // "Song III"
    /\s+iv\s*$/i,          // "Song IV"
    /\s+pt\.?\s*2/i,       // "Song Pt. 2"
    /\s+part\.?\s*2/i,     // "Song Part 2"
    /\s+vol\.?\s*2/i,      // "Song Vol. 2"
    /\s+chapter\s*2/i,     // "Song Chapter 2"
    /\s+remix\b/i,         // "Song Remix" — different version
    /\s+acoustic\b/i,      // "Song Acoustic" — different version
    /\s+live\b/i,          // "Song Live" — different version
  ];

  // Noise suffixes to strip before comparing titles
  private readonly NOISE_PATTERNS = [
    /\s*\(official\s*(music\s*)?video\)/gi,
    /\s*\(official\s*audio\)/gi,
    /\s*\(lyrics?\s*(video)?\)/gi,
    /\s*\(ft\..*?\)/gi,
    /\s*\(feat\..*?\)/gi,
    /\s*\[.*?\]/g,
    /\s*-\s*vevo$/gi,
    /\s*\|\s*.*$/gi,       // "Song | Artist" → "Song"
  ];

  constructor(private readonly firestore: FirestoreService) {}

  /**
   * Check if videoId is a known duplicate of an existing song.
   * Returns the canonical song ID if it's a known duplicate, null otherwise.
   */
  async getCanonicalSongId(videoId: string): Promise<string | null> {
    const doc = await this.firestore.doc(`song_duplicates/${videoId}`).get();
    if (doc.exists) {
      return doc.data().canonicalSongId as string;
    }
    return null;
  }

  /**
   * Check if two videoIds are known to be distinct (not duplicates).
   */
  async areKnownDistinct(videoIdA: string, videoIdB: string): Promise<boolean> {
    const key = this.distinctKey(videoIdA, videoIdB);
    const doc = await this.firestore.doc(`song_distinct/${key}`).get();
    return doc.exists;
  }

  /**
   * Determine if two songs (from YouTube results) are duplicates using:
   * 1. song_duplicates / song_distinct cache lookups
   * 2. Code-based rules (number suffixes, duration diff, title similarity)
   *
   * Returns the canonical song ID to use (the "winner"), or null if distinct.
   */
  async checkDuplicate(
    videoIdA: string,
    titleA: string,
    artistA: string,
    durationA: number,
    videoIdB: string,
    titleB: string,
    artistB: string,
    durationB: number,
    existingSongIdB?: string, // Firestore song ID for B if it already exists
  ): Promise<DeduplicationResult> {
    // 1. Check known duplicate cache
    const canonicalA = await this.getCanonicalSongId(videoIdA);
    if (canonicalA) return { isDuplicate: true, canonicalSongId: canonicalA };

    const canonicalB = await this.getCanonicalSongId(videoIdB);
    if (canonicalB) return { isDuplicate: true, canonicalSongId: canonicalB };

    // 2. Check known distinct cache
    if (await this.areKnownDistinct(videoIdA, videoIdB)) {
      return { isDuplicate: false, canonicalSongId: null };
    }

    // 3. Apply code-based rules
    const cleanA = this.cleanTitle(titleA);
    const cleanB = this.cleanTitle(titleB);
    const normArtistA = this.normalizeArtist(artistA);
    const normArtistB = this.normalizeArtist(artistB);

    // Rule: if either title has a sequel/part suffix → distinct
    if (this.hasSequelSuffix(cleanA) !== this.hasSequelSuffix(cleanB)) {
      await this.recordDistinct(videoIdA, videoIdB, 'sequel_suffix');
      return { isDuplicate: false, canonicalSongId: null };
    }
    if (this.hasSequelSuffix(cleanA) && this.hasSequelSuffix(cleanB)) {
      // Both have sequel suffixes — only merge if they're identical after cleaning
      if (cleanA.toLowerCase() !== cleanB.toLowerCase()) {
        await this.recordDistinct(videoIdA, videoIdB, 'different_sequel');
        return { isDuplicate: false, canonicalSongId: null };
      }
    }

    // Rule: duration difference > 90s → distinct (different songs, not just versions)
    if (durationA > 0 && durationB > 0 && Math.abs(durationA - durationB) > 90) {
      await this.recordDistinct(videoIdA, videoIdB, 'duration_mismatch');
      return { isDuplicate: false, canonicalSongId: null };
    }

    // Rule: artist similarity check — different artists = distinct
    const artistSimilarity = this.similarity(normArtistA, normArtistB);
    if (artistSimilarity < 0.7) {
      await this.recordDistinct(videoIdA, videoIdB, 'different_artist');
      return { isDuplicate: false, canonicalSongId: null };
    }

    // Rule: title similarity check
    const titleSimilarity = this.similarity(cleanA.toLowerCase(), cleanB.toLowerCase());
    if (titleSimilarity < 0.85) {
      await this.recordDistinct(videoIdA, videoIdB, 'low_title_similarity');
      return { isDuplicate: false, canonicalSongId: null };
    }

    // They're duplicates — pick the canonical (shorter duration = cleaner version)
    const canonicalVideoId = (durationA <= durationB || durationB === 0) ? videoIdA : videoIdB;
    const canonicalSongId = existingSongIdB && canonicalVideoId === videoIdB
      ? existingSongIdB
      : null; // will be assigned after the song is saved

    this.logger.log(
      `Duplicate detected: "${titleA}" (${videoIdA}) ≈ "${titleB}" (${videoIdB}) — canonical: ${canonicalVideoId}`
    );

    return { isDuplicate: true, canonicalSongId };
  }

  /**
   * Record that videoId is a duplicate pointing to canonicalSongId.
   */
  async recordDuplicate(videoId: string, canonicalSongId: string, canonicalVideoId: string): Promise<void> {
    await this.firestore.doc(`song_duplicates/${videoId}`).set({
      canonicalSongId,
      canonicalVideoId,
      detectedAt: new Date(),
    });
  }

  /**
   * Record that two videoIds are known to be distinct songs.
   */
  async recordDistinct(videoIdA: string, videoIdB: string, reason: string): Promise<void> {
    const key = this.distinctKey(videoIdA, videoIdB);
    await this.firestore.doc(`song_distinct/${key}`).set({
      videoIdA,
      videoIdB,
      reason,
      confirmedAt: new Date(),
    });
  }

  /**
   * Deduplicate a list of YouTube results purely in code.
   * Returns the deduplicated list and a map of removed videoId → kept videoId.
   */
  deduplicateByCode(
    songs: Array<{ videoId: string; title: string; artistName: string; durationSeconds?: number }>,
  ): {
    unique: typeof songs;
    duplicateMap: Map<string, string>; // removed videoId → kept videoId
  } {
    const kept: typeof songs = [];
    const duplicateMap = new Map<string, string>();

    for (const song of songs) {
      const cleanTitle = this.cleanTitle(song.title).toLowerCase();
      const normArtist = this.normalizeArtist(song.artistName);
      const duration = song.durationSeconds || 0;

      let foundDuplicate = false;
      for (const existing of kept) {
        const existingClean = this.cleanTitle(existing.title).toLowerCase();
        const existingArtist = this.normalizeArtist(existing.artistName);
        const existingDuration = existing.durationSeconds || 0;

        // Skip if sequel suffix mismatch
        if (this.hasSequelSuffix(cleanTitle) !== this.hasSequelSuffix(existingClean)) continue;

        // Skip if duration difference > 90s
        if (duration > 0 && existingDuration > 0 && Math.abs(duration - existingDuration) > 90) continue;

        // Skip if artist too different
        if (this.similarity(normArtist, existingArtist) < 0.7) continue;

        // Check title similarity
        if (this.similarity(cleanTitle, existingClean) >= 0.85) {
          // It's a duplicate — keep the shorter duration version
          if (duration > 0 && existingDuration > 0 && duration < existingDuration) {
            // Current song is shorter — replace existing with current
            duplicateMap.set(existing.videoId, song.videoId);
            const idx = kept.indexOf(existing);
            kept[idx] = song;
          } else {
            duplicateMap.set(song.videoId, existing.videoId);
          }
          foundDuplicate = true;
          break;
        }
      }

      if (!foundDuplicate) {
        kept.push(song);
      }
    }

    return { unique: kept, duplicateMap };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private cleanTitle(title: string): string {
    let clean = title;
    for (const pattern of this.NOISE_PATTERNS) {
      clean = clean.replace(pattern, '');
    }
    return clean.trim();
  }

  private hasSequelSuffix(cleanTitle: string): boolean {
    return this.SEQUEL_PATTERNS.some(p => p.test(cleanTitle));
  }

  private normalizeArtist(artist: string): string {
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

  private similarity(a: string, b: string): number {
    if (a === b) return 1;
    if (a.length < 2 || b.length < 2) return 0;
    const bigrams1 = this.bigrams(a);
    const bigrams2 = this.bigrams(b);
    const intersection = bigrams1.filter(bg => bigrams2.includes(bg)).length;
    return (2 * intersection) / (bigrams1.length + bigrams2.length);
  }

  private bigrams(str: string): string[] {
    const result: string[] = [];
    for (let i = 0; i < str.length - 1; i++) {
      result.push(str.substring(i, i + 2));
    }
    return result;
  }

  private distinctKey(videoIdA: string, videoIdB: string): string {
    return [videoIdA, videoIdB].sort().join('_');
  }
}
