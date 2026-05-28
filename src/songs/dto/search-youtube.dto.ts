import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class SearchYouTubeDto {
  @IsString()
  @IsNotEmpty()
  query: string;

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
