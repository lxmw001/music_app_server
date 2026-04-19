import { IsString, IsNotEmpty } from 'class-validator';

export class SearchYouTubeDto {
  @IsString()
  @IsNotEmpty()
  query: string;
}
