import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { FirestoreService } from '../firestore/firestore.service';
import { CacheKeys } from '../cache/cache-keys';
import { SuggestionResultDto } from './dto/suggestion-result.dto';

const MAX_SUGGESTIONS = 10;

type EntityType = 'song' | 'artist' | 'album' | 'playlist';

interface CollectionConfig {
  name: string;
  nameField: string;
  type: EntityType;
}

const COLLECTIONS: CollectionConfig[] = [
  { name: 'songs', nameField: 'title', type: 'song' },
  { name: 'artists', nameField: 'name', type: 'artist' },
  { name: 'albums', nameField: 'title', type: 'album' },
  { name: 'playlists', nameField: 'name', type: 'playlist' },
];

@Injectable()
export class SuggestionsService {
  constructor(
    private readonly firestore: FirestoreService,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async suggest(q: string): Promise<SuggestionResultDto[]> {
    if (!q || q.trim().length < 2) {
      throw new BadRequestException(
        'Suggestion query must be at least 2 characters',
      );
    }

    const normalized = q.trim().toLowerCase();
    const cacheKey = CacheKeys.suggestion(normalized);
    const cached = await this.cache.get<SuggestionResultDto[]>(cacheKey);
    if (cached) return cached;

    const prefixResults: SuggestionResultDto[] = [];
    const substringResults: SuggestionResultDto[] = [];
    const seen = new Set<string>(); // key: `${type}:${id}`

    await Promise.all(
      COLLECTIONS.map(async ({ name, type }) => {
        const [prefixSnap, tokenSnap] = await Promise.all([
          this.firestore
            .collection(name)
            .where('nameLower', '>=', normalized)
            .where('nameLower', '<=', normalized + '\uf8ff')
            .get(),
          this.firestore
            .collection(name)
            .where('searchTokens', 'array-contains', normalized)
            .get(),
        ]);

        for (const doc of prefixSnap.docs) {
          const data = doc.data();
          // Skip system playlists
          if (type === 'playlist' && data['ownerUid'] === null) continue;
          const key = `${type}:${doc.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            prefixResults.push({
              id: doc.id,
              name: (data['name'] ?? data['title'] ?? '') as string,
              type,
            });
          }
        }

        for (const doc of tokenSnap.docs) {
          const data = doc.data();
          if (type === 'playlist' && data['ownerUid'] === null) continue;
          const key = `${type}:${doc.id}`;
          if (!seen.has(key)) {
            seen.add(key);
            substringResults.push({
              id: doc.id,
              name: (data['name'] ?? data['title'] ?? '') as string,
              type,
            });
          }
        }
      }),
    );

    // Prefix matches ranked before substring matches, capped at MAX_SUGGESTIONS
    const results = [...prefixResults, ...substringResults].slice(
      0,
      MAX_SUGGESTIONS,
    );

    await this.cache.set(cacheKey, results, 60_000);
    return results;
  }
}
