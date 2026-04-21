import { Controller, Get, Param, Query, Post, Body, UseGuards } from '@nestjs/common';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { SongsService } from './songs.service';
import { PaginationDto } from './dto/pagination.dto';
import { SongResponseDto } from './dto/song-response.dto';
import { SubmitSearchDto } from './dto/submit-search.dto';
import { SearchYouTubeDto } from './dto/search-youtube.dto';
import { SearchYouTubeResponseDto } from './dto/search-youtube-response.dto';

@UseGuards(OptionalAuthGuard)
@Controller('songs')
export class SongsController {
  constructor(private readonly songsService: SongsService) {}

  @Get()
  findAll(@Query() pagination: PaginationDto): Promise<SongResponseDto[]> {
    return this.songsService.findAll(pagination);
  }

  @Get(':id')
  findById(@Param('id') id: string): Promise<SongResponseDto> {
    return this.songsService.findById(id);
  }

  @Get(':id/generate-playlist')
  generatePlaylist(@Param('id') id: string, @Query('limit') limit?: number): Promise<SongResponseDto[]> {
    return this.songsService.generatePlaylist(id, limit ? parseInt(limit as any) : 30);
  }

  @Post('submit-search')
  submitSearch(@Body() dto: SubmitSearchDto): Promise<{ processed: number; message: string }> {
    return this.songsService.submitSearch(dto);
  }

  @Post('search-youtube')
  searchYouTube(@Body() dto: SearchYouTubeDto): Promise<SearchYouTubeResponseDto> {
    return this.songsService.searchYouTube(dto);
  }

  @Post('clean-youtube-results')
  cleanYouTubeResults(@Body() body: { results: any[] }) {
    return this.songsService.cleanYouTubeResults(body.results);
  }
}
