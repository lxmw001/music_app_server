export class SearchSongDto {
  id?: string;
  title: string;
  artistName: string;
  youtubeId: string;
  thumbnailUrl: string;
  duration: number;
  rank: number;
  artistId?: string;
  albumId?: string;
  genres: string[];
  tags: string[];
  album?: string;
  releaseDate?: string;
  listeners?: number;
  mbid?: string;
  streamUrl?: string | null;
  streamUrlExpiresAt?: string | null;
}

export class SearchMixDto {
  title: string;
  youtubeId: string;
  thumbnailUrl: string;
  rank: number;
  genres: string[];
  streamUrl?: string | null;
  streamUrlExpiresAt?: string | null;
}

export class SearchVideoDto {
  title: string;
  youtubeId: string;
  thumbnailUrl: string;
  rank: number;
}

export class SearchArtistDto {
  id?: string;
  name: string;
  imageUrl?: string;
  followerCount?: number;
  rank: number;
}

export class SearchYouTubeResponseDto {
  songs: SearchSongDto[];
  mixes: SearchMixDto[];
  videos: SearchVideoDto[];
  artists: SearchArtistDto[];
}
