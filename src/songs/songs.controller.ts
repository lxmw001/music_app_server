import { Body, Controller, Get, Param, Query, Post, UseGuards } from '@nestjs/common';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { SongsService } from './songs.service';
import { PaginationDto } from './dto/pagination.dto';
import { SearchYouTubeResponseDto, SearchSongDto } from './dto/search-youtube-response.dto';

@UseGuards(OptionalAuthGuard)
@Controller('songs')
export class SongsController {
  constructor(private readonly songsService: SongsService) {}

  @Get()
  findAll(@Query() pagination: PaginationDto): Promise<SearchSongDto[]> {
    return this.songsService.findAll(pagination);
  }

  @Get('trending')
  getTrendingMusic(
    @Query('country') country?: string,
    @Query('limit') limit?: number,
    @Query('force') force?: string,
  ): Promise<SearchYouTubeResponseDto> {
    return this.songsService.getTrendingMusic(country || 'EC', limit ? parseInt(limit as any) : 50, force === 'true');
  }

  @Get('searches')
  getAllSearches(): Promise<string[]> {
    return this.songsService.getAllSearches();
  }

  @Get('search-youtube')
  searchYouTube(@Query('query') query: string): Promise<SearchYouTubeResponseDto> {
    return this.songsService.searchYouTube({ query });
  }

  @Get(':id')
  findById(@Param('id') id: string): Promise<SearchSongDto> {
    return this.songsService.findById(id);
  }

  @Get(':id/generate-playlist')
  generatePlaylist(
    @Param('id') id: string,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ): Promise<SearchSongDto[]> {
    return this.songsService.generatePlaylist(id, limit ? parseInt(limit as any) : 30, search);
  }

  @Post(':id/refresh-metadata')
  refreshMetadata(@Param('id') id: string): Promise<{ success: boolean; message: string }> {
    return this.songsService.refreshMetadata(id);
  }

  @Post(':id/stream-url')
  saveStreamUrl(
    @Param('id') id: string,
    @Body() body: { streamUrl: string; expiresAt: string },
  ): Promise<void> {
    return this.songsService.saveStreamUrl(id, body.streamUrl, new Date(body.expiresAt));
  }

  @Post('mixes/:youtubeId/stream-url')
  saveMixStreamUrl(
    @Param('youtubeId') youtubeId: string,
    @Body() body: { streamUrl: string; expiresAt: string },
  ): Promise<void> {
    return this.songsService.saveMixStreamUrl(youtubeId, body.streamUrl, new Date(body.expiresAt));
  }
}
