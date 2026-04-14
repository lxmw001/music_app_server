export interface GeminiArtistResult {
  name: string;
  rank: number;
  topSongs?: string[];
}

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
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
  durationSeconds?: number;
}

export interface SyncRequestDto {
  genres?: string[];
  force?: boolean;
}
