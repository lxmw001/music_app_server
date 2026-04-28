export class SongResponseDto {
  id: string;
  title: string;
  artistId: string;
  artistName: string;
  albumId: string | null;
  durationSeconds: number;
  coverImageUrl: string | null;
  youtubeId: string | null;
  genre: string | null;
  tags?: string[];
  streamUrl?: string | null;
  streamUrlExpiresAt?: string | null;
}
