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
  genre?: string;
  tags?: string[];
  album?: string;
  releaseDate?: string;
  listeners?: number;
  mbid?: string;
}

export class SearchMixDto {
  title: string;
  youtubeId: string;
  thumbnailUrl: string;
  rank: number;
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
