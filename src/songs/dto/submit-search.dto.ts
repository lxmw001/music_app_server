import { IsArray, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class YouTubeVideoDto {
  @IsString()
  videoId: string;

  @IsString()
  title: string;

  @IsString()
  channelTitle: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  durationSeconds?: number;
}

export class SubmitSearchDto {
  @IsString()
  searchQuery: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => YouTubeVideoDto)
  results: YouTubeVideoDto[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
