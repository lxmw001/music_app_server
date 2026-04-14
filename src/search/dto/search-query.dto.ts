import { IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class SearchQueryDto {
  @IsString()
  @MinLength(1)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  q: string;
}
