import { IsString, IsOptional, IsInt } from 'class-validator';

export class ErrorReportDto {
  @IsString()
  error: string;

  @IsOptional()
  @IsString()
  stackTrace?: string;

  @IsOptional()
  @IsString()
  file?: string;

  @IsOptional()
  @IsString()
  line?: string;

  @IsOptional()
  @IsString()
  screen?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  endpoint?: string;

  @IsOptional()
  @IsInt()
  statusCode?: number;

  @IsOptional()
  @IsString()
  songId?: string;

  @IsOptional()
  @IsString()
  youtubeId?: string;

  @IsOptional()
  @IsString()
  requestBody?: string;

  @IsOptional()
  @IsString()
  deviceInfo?: string;

  @IsOptional()
  @IsString()
  appVersion?: string;
}
