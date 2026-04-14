import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class SyncRequestDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  genres?: string[];

  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
