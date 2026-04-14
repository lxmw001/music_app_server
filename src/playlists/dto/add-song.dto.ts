import { IsNotEmpty, IsString } from 'class-validator';

export class AddSongDto {
  @IsString()
  @IsNotEmpty()
  songId: string;
}
