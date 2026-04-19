export interface GeminiArtistResult {
  name: string;
  rank: number;
  topSongs?: string[];
}

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
}

export interface RawYouTubeResult extends YouTubeSearchResult {
  genre: string;
  artistRank: number;
  artistName: string;
}

export interface CleanedSongResult {
  title: string;
  artistName: string;
  albumName?: string;
  genre: string;
  artistRank: number;
  youtubeId: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  tags?: string[];
}

export interface SyncRequestDto {
  genres?: string[];
  force?: boolean;
  country?: string;
}

export interface SyncProgress {
  id: string;
  status: 'running' | 'paused' | 'completed' | 'failed';
  startedAt: Date;
  lastUpdatedAt: Date;
  completedAt?: Date;
  country?: string;
  currentGenre?: string;
  currentArtistIndex?: number;
  processedGenres: string[];
  processedArtistsByGenre: Record<string, string[]>; // genre -> artist names
  artistsByGenre: Record<string, GeminiArtistResult[]>; // cached artist lists
  totalArtists: number;
  processedArtists: number;
  totalSongs: number;
  processedSongs: number;
  failedArtists: Array<{ genre: string; artist: string; error: string }>;
  quotaExceeded: boolean;
  error?: string;
}
