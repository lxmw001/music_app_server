import { IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class SuggestionQueryDto {
  @IsString()
  @MinLength(2)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q: string;
}
