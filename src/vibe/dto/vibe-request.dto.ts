import { IsString, IsOptional, IsInt, IsArray, Min, Max } from 'class-validator';

export class VibeRequestDto {
  @IsString()
  vibeId: string;

  @IsOptional()
  @IsString()
  subCategoryKey?: string;

  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(new Date().getFullYear())
  birthYear?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  genres?: string[];

  @IsOptional()
  @IsString()
  localTime?: string;

  @IsOptional()
  @IsString()
  dayOfWeek?: string;
}
