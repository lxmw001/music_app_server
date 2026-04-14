export const CacheKeys = {
  suggestion: (q: string) => `suggestions:${q.toLowerCase()}`,
  search: (q: string) => `search:${q.toLowerCase()}`,
  song: (id: string) => `song:${id}`,
  artist: (id: string) => `artist:${id}`,
  album: (id: string) => `album:${id}`,
};
