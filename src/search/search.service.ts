import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { FirestoreService } from '../firestore/firestore.service';
import { CacheKeys } from '../cache/cache-keys';

export interface SearchResults {
  songs: Array<{ id: string; [key: string]: unknown }>;
  artists: Array<{ id: string; [key: string]: unknown }>;
  albums: Array<{ id: string; [key: string]: unknown }>;
  playlists: Array<{ id: string; [key: string]: unknown }>;
}

@Injectable()
export class SearchService {
  constructor(
    private readonly firestore: FirestoreService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async search(q: string): Promise<SearchResults> {
    if (!q || q.trim().length === 0) {
      throw new BadRequestException('Search query must not be empty');
    }

    const normalized = q.trim().toLowerCase();
    const cacheKey = CacheKeys.search(normalized);
    const cached = await this.cache.get<SearchResults>(cacheKey);
    if (cached) return cached;

    const [songs, artists, albums, playlists] = await Promise.all([
      this.searchCollection('songs', 'title', normalized),
      this.searchCollection('artists', 'name', normalized),
      this.searchCollection('albums', 'title', normalized),
      this.searchCollection('playlists', 'name', normalized),
    ]);

    const results: SearchResults = { songs, artists, albums, playlists };
    await this.cache.set(cacheKey, results, 30_000);
    return results;
  }

  private async searchCollection(
    collectionName: string,
    nameField: string,
    q: string,
  ): Promise<Array<{ id: string; [key: string]: unknown }>> {
    const nameLowerField = 'nameLower';

    // Prefix match via range query on nameLower
    const prefixSnapshot = await this.firestore
      .collection(collectionName)
      .where(nameLowerField, '>=', q)
      .where(nameLowerField, '<=', q + '\uf8ff')
      .get();

    // Substring match via searchTokens array-contains
    const tokenSnapshot = await this.firestore
      .collection(collectionName)
      .where('searchTokens', 'array-contains', q)
      .get();

    // Merge and deduplicate by document ID
    const seen = new Set<string>();
    const results: Array<{ id: string; [key: string]: unknown }> = [];

    for (const doc of [...prefixSnapshot.docs, ...tokenSnapshot.docs]) {
      if (!seen.has(doc.id)) {
        seen.add(doc.id);
        const data = doc.data();
        // Exclude system playlists from search results
        if (collectionName === 'playlists' && data['ownerUid'] === null) {
          continue;
        }
        results.push({ id: doc.id, ...data });
      }
    }

    return results;
  }
}
