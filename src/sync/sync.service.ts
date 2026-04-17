import { Injectable, Logger } from '@nestjs/common';
import { GeminiService } from './gemini.service';
import { YouTubeService } from './youtube.service';
import { FirestoreService } from '../firestore/firestore.service';
import { SyncProgress } from './interfaces/sync.interfaces';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly geminiService: GeminiService,
    private readonly youtubeService: YouTubeService,
    private readonly firestoreService: FirestoreService,
  ) {}

  async startSync(genres?: string[], country?: string): Promise<{ syncId: string; message: string }> {
    const syncId = `sync_${Date.now()}`;
    
    const progress: SyncProgress = {
      id: syncId,
      status: 'running',
      startedAt: new Date(),
      lastUpdatedAt: new Date(),
      country,
      processedGenres: [],
      processedArtistsByGenre: {},
      artistsByGenre: {},
      totalArtists: 0,
      processedArtists: 0,
      totalSongs: 0,
      processedSongs: 0,
      failedArtists: [],
      quotaExceeded: false,
    };

    await this.saveProgress(progress);
    
    // Run sync in background
    this.runSync(syncId, genres, country).catch(err => {
      this.logger.error(`Sync ${syncId} failed: ${err.message}`);
    });

    return { syncId, message: 'Sync started. Check progress with GET /sync/progress/:syncId' };
  }

  async getProgress(syncId: string): Promise<SyncProgress | null> {
    const doc = await this.firestoreService.collection('sync_progress').doc(syncId).get();
    if (!doc.exists) return null;
    return doc.data() as SyncProgress;
  }

  async resumeSync(syncId: string): Promise<{ message: string }> {
    const progress = await this.getProgress(syncId);
    if (!progress) throw new Error('Sync not found');
    if (progress.status === 'completed') throw new Error('Sync already completed');
    
    progress.status = 'running';
    progress.quotaExceeded = false;
    progress.lastUpdatedAt = new Date();
    await this.saveProgress(progress);

    this.runSync(syncId).catch(err => {
      this.logger.error(`Resume sync ${syncId} failed: ${err.message}`);
    });

    return { message: 'Sync resumed' };
  }

  async incrementalSync(genre: string, country?: string): Promise<{ syncId: string; message: string; newArtists: number }> {
    const syncId = `sync_incremental_${genre}_${Date.now()}`;
    
    // Get fresh artist list from Gemini
    const freshArtists = await this.geminiService.getArtistsForGenre(genre);
    
    // Find existing syncs for this genre to get processed artists
    const existingProcessed = await this.getProcessedArtistsForGenre(genre);
    
    // Filter to only new artists
    const newArtists = freshArtists.filter(
      artist => !existingProcessed.includes(artist.name.toLowerCase())
    );

    if (newArtists.length === 0) {
      return { syncId, message: 'No new artists found', newArtists: 0 };
    }

    const progress: SyncProgress = {
      id: syncId,
      status: 'running',
      startedAt: new Date(),
      lastUpdatedAt: new Date(),
      country,
      processedGenres: [],
      processedArtistsByGenre: { [genre]: [] },
      artistsByGenre: { [genre]: newArtists },
      totalArtists: newArtists.length,
      processedArtists: 0,
      totalSongs: 0,
      processedSongs: 0,
      failedArtists: [],
      quotaExceeded: false,
    };

    await this.saveProgress(progress);
    
    // Run sync for just this genre with new artists
    this.runSync(syncId, [genre], country).catch(err => {
      this.logger.error(`Incremental sync ${syncId} failed: ${err.message}`);
    });

    return { 
      syncId, 
      message: `Incremental sync started for ${newArtists.length} new artists in ${genre}`,
      newArtists: newArtists.length
    };
  }

  private async getProcessedArtistsForGenre(genre: string): Promise<string[]> {
    const processed = new Set<string>();
    
    // Query all sync progress documents
    const snapshot = await this.firestoreService.collection('sync_progress').get();
    
    for (const doc of snapshot.docs) {
      const data = doc.data() as SyncProgress;
      const artistsForGenre = data.processedArtistsByGenre?.[genre] || [];
      artistsForGenre.forEach(name => processed.add(name.toLowerCase()));
    }
    
    return Array.from(processed);
  }

  private async runSync(syncId: string, requestedGenres?: string[], country?: string): Promise<void> {
    const progress = await this.getProgress(syncId);
    if (!progress) return;

    try {
      const genres = requestedGenres || await this.geminiService.getPopularGenres(country || progress.country);
      
      for (const genre of genres) {
        if (progress.processedGenres.includes(genre)) {
          this.logger.log(`Skipping already processed genre: ${genre}`);
          continue;
        }

        progress.currentGenre = genre;
        await this.saveProgress(progress);

        // Get or reuse cached artist list
        let artists = progress.artistsByGenre[genre];
        if (!artists) {
          artists = await this.geminiService.getArtistsForGenre(genre);
          progress.artistsByGenre[genre] = artists;
          progress.totalArtists += artists.length;
          await this.saveProgress(progress);
        }

        if (!progress.processedArtistsByGenre[genre]) {
          progress.processedArtistsByGenre[genre] = [];
        }

        for (let i = 0; i < artists.length; i++) {
          const artist = artists[i];
          
          if (progress.processedArtistsByGenre[genre].includes(artist.name)) {
            this.logger.log(`Skipping already processed artist: ${artist.name}`);
            continue;
          }

          progress.currentArtistIndex = i;
          await this.saveProgress(progress);

          try {
            // Save or get artist from Firestore
            const artistDoc = await this.saveOrGetArtist(artist.name, genre);
            
            const queries = await this.geminiService.generateSearchQueries(artist.name, artist.topSongs);
            
            for (const query of queries) {
              try {
                const results = await this.youtubeService.searchVideos(query, 10);
                
                const rawResults = results.map(r => ({
                  ...r,
                  genre,
                  artistRank: artist.rank,
                  artistName: artist.name,
                }));

                const cleaned = await this.geminiService.cleanAndDeduplicate(rawResults);
                
                for (const song of cleaned) {
                  await this.saveSong(song, artistDoc.id, genre);
                  progress.processedSongs++;
                }

                progress.totalSongs += cleaned.length;
                await this.saveProgress(progress);

              } catch (error) {
                if (this.isQuotaError(error)) {
                  const resetTime = this.getQuotaResetTime();
                  const waitMs = resetTime.getTime() - Date.now();
                  
                  this.logger.warn(`YouTube quota exceeded. Will auto-resume at ${resetTime.toISOString()}`);
                  progress.status = 'paused';
                  progress.quotaExceeded = true;
                  progress.lastUpdatedAt = new Date();
                  await this.saveProgress(progress);
                  
                  // Schedule auto-resume
                  setTimeout(() => {
                    this.logger.log(`Auto-resuming sync ${syncId} after quota reset`);
                    this.resumeSync(syncId).catch(err => {
                      this.logger.error(`Auto-resume failed: ${err.message}`);
                    });
                  }, waitMs);
                  
                  return;
                }
                this.logger.error(`Query "${query}" failed: ${error.message}`);
              }
            }

            progress.processedArtists++;
            progress.processedArtistsByGenre[genre].push(artist.name);
            await this.saveProgress(progress);

          } catch (error) {
            this.logger.error(`Artist ${artist.name} failed: ${error.message}`);
            progress.failedArtists.push({
              genre,
              artist: artist.name,
              error: error.message,
            });
            progress.processedArtistsByGenre[genre].push(artist.name);
            await this.saveProgress(progress);
          }
        }

        progress.processedGenres.push(genre);
        progress.currentGenre = undefined;
        progress.currentArtistIndex = undefined;
        await this.saveProgress(progress);
      }

      progress.status = 'completed';
      progress.completedAt = new Date();
      progress.lastUpdatedAt = new Date();
      await this.saveProgress(progress);

      this.logger.log(`Sync ${syncId} completed successfully`);

    } catch (error) {
      this.logger.error(`Sync ${syncId} failed: ${error.message}`);
      progress.status = 'failed';
      progress.error = error.message;
      progress.lastUpdatedAt = new Date();
      await this.saveProgress(progress);
    }
  }

  private async saveOrGetArtist(artistName: string, genre: string): Promise<any> {
    const nameLower = artistName.toLowerCase();
    
    // Check if artist already exists
    const existing = await this.firestoreService.collection('artists')
      .where('nameLower', '==', nameLower)
      .limit(1)
      .get();

    if (!existing.empty) {
      const doc = existing.docs[0];
      const data = doc.data();
      
      // Add genre if not already present
      const genres = data.genres || [];
      if (!genres.includes(genre)) {
        await doc.ref.update({ genres: [...genres, genre] });
      }
      
      return { id: doc.id, ...data };
    }

    // Create new artist
    const artistData = {
      name: artistName,
      nameLower,
      genres: [genre],
      createdAt: new Date(),
    };

    const docRef = await this.firestoreService.collection('artists').add(artistData);
    return { id: docRef.id, ...artistData };
  }

  private async saveSong(song: any, artistId: string, genre: string): Promise<void> {
    const nameLower = song.title.toLowerCase();
    
    // Check if song already exists by title + artist
    const existingByTitleArtist = await this.firestoreService.collection('songs')
      .where('nameLower', '==', nameLower)
      .where('artistName', '==', song.artistName)
      .limit(5)
      .get();

    if (!existingByTitleArtist.empty) {
      // Find the best existing version
      const existingDocs = existingByTitleArtist.docs;
      const newDuration = song.durationSeconds || 0;
      
      // Ideal song duration is 2-5 minutes (120-300 seconds)
      const idealMin = 120;
      const idealMax = 300;
      
      const scoreSong = (duration: number) => {
        if (duration >= idealMin && duration <= idealMax) return 100;
        if (duration < idealMin) return Math.max(0, 100 - (idealMin - duration));
        return Math.max(0, 100 - (duration - idealMax) / 10);
      };
      
      const newScore = scoreSong(newDuration);
      let shouldReplace = false;
      let docToUpdate = existingDocs[0];
      
      for (const doc of existingDocs) {
        const data = doc.data();
        const existingDuration = data.durationSeconds || 0;
        const existingScore = scoreSong(existingDuration);
        
        // Replace if new song has better duration score
        if (newScore > existingScore + 10) {
          shouldReplace = true;
          docToUpdate = doc;
          break;
        }
        
        // Add genre to existing song
        const genres = data.genres || [data.genre];
        if (!genres.includes(genre)) {
          await doc.ref.update({ genres: [...genres, genre] });
        }
      }
      
      if (shouldReplace) {
        this.logger.log(`Replacing song with better version: ${song.title} (${newDuration}s vs ${docToUpdate.data().durationSeconds}s)`);
        await docToUpdate.ref.update({
          youtubeId: song.youtubeId,
          coverImageUrl: song.thumbnailUrl || docToUpdate.data().coverImageUrl,
          durationSeconds: newDuration,
          genres: [...new Set([...(docToUpdate.data().genres || [docToUpdate.data().genre]), genre])],
        });
      } else {
        this.logger.log(`Song already exists with good version: ${song.title}`);
      }
      
      return;
    }

    const songData = {
      title: song.title,
      artistName: song.artistName,
      artistId,
      nameLower,
      youtubeId: song.youtubeId,
      coverImageUrl: song.thumbnailUrl || '',
      genre,
      genres: [genre],
      artistRank: song.artistRank,
      durationSeconds: song.durationSeconds || 0,
      searchTokens: this.generateSearchTokens(song.title, song.artistName),
      createdAt: new Date(),
    };

    await this.firestoreService.collection('songs').add(songData);
  }

  private generateSearchTokens(title: string, artist: string): string[] {
    const tokens = new Set<string>();
    const text = `${title} ${artist}`.toLowerCase();
    
    const words = text.split(/\s+/);
    for (const word of words) {
      if (word.length >= 2) {
        for (let i = 2; i <= word.length; i++) {
          tokens.add(word.substring(0, i));
        }
      }
    }
    
    return Array.from(tokens);
  }

  private async saveProgress(progress: SyncProgress): Promise<void> {
    progress.lastUpdatedAt = new Date();
    await this.firestoreService.collection('sync_progress').doc(progress.id).set(progress);
  }

  private isQuotaError(error: any): boolean {
    return error?.message?.includes('quota') || 
           error?.response?.data?.error?.errors?.[0]?.reason === 'quotaExceeded';
  }

  private getQuotaResetTime(): Date {
    // YouTube quota resets at midnight Pacific Time
    const now = new Date();
    const pacificTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    
    // Set to next midnight PT
    const resetTime = new Date(pacificTime);
    resetTime.setHours(24, 0, 0, 0);
    
    // Convert back to local time
    const offset = now.getTime() - pacificTime.getTime();
    return new Date(resetTime.getTime() + offset);
  }
}
