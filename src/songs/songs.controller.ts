import { Body, Controller, Get, Param, Query, Post, UseGuards, Res, Headers, Logger } from '@nestjs/common';
import { Response } from 'express';
import { spawn } from 'child_process';
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
  searchYouTube(@Query('query') query: string, @Query('force') force?: string): Promise<SearchYouTubeResponseDto> {
    return this.songsService.searchYouTube({ query, force: force === 'true' });
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

  @Post(':id/find-alternative')
  findAlternative(@Param('id') id: string): Promise<SearchSongDto> {
    return this.songsService.findAlternative(id);
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

  @Get(':videoId/audio-stream')
  @UseGuards() // No auth — stream is public, protected only by knowing the video ID
  async streamAudio(
    @Param('videoId') videoId: string,
    @Headers('range') range: string,
    @Res() res: Response,
  ): Promise<void> {
    const logger = new Logger('AudioStream');
    const args = this.songsService.getAudioStreamArgs(videoId, range);
    const proc = spawn('python3', args, { timeout: 300_000 });

    let headerParsed = false;
    let headerBuf = '';

    proc.stdout.on('data', (chunk: Buffer) => {
      if (headerParsed) {
        res.write(chunk);
        return;
      }

      // First newline-terminated line is the JSON header, rest is audio bytes
      headerBuf += chunk.toString('binary');
      const nl = headerBuf.indexOf('\n');
      if (nl === -1) return;

      const headerLine = headerBuf.slice(0, nl);
      const rest = Buffer.from(headerBuf.slice(nl + 1), 'binary');
      headerParsed = true;

      let info: any;
      try {
        info = JSON.parse(headerLine);
      } catch {
        res.status(500).json({ message: 'bad header from stream script' });
        proc.kill();
        return;
      }

      if (info.error) {
        logger.error(`script error: ${info.error}`);
        res.status(502).json({ message: info.error });
        proc.kill();
        return;
      }

      res.status(info.status ?? 200);
      res.setHeader('Content-Type', info.content_type ?? 'audio/mp4');
      res.setHeader('Accept-Ranges', 'bytes');
      if (info.content_length) res.setHeader('Content-Length', info.content_length);
      if (info.content_range) res.setHeader('Content-Range', info.content_range);

      if (rest.length > 0) res.write(rest);
    });

    proc.stderr.on('data', (d: Buffer) => {
      logger.warn(`stderr: ${d.toString().slice(0, 200)}`);
    });

    proc.on('close', (code) => {
      if (!headerParsed && code !== 0) {
        logger.error(`script exited ${code} before header`);
        if (!res.headersSent) {
          res.status(502).json({ message: `stream script exited ${code}` });
          return;
        }
      }
      if (!res.writableEnded) res.end();
    });

    proc.on('error', (err) => {
      logger.error(`spawn error: ${err.message}`);
      if (!res.headersSent) res.status(500).json({ message: err.message });
      if (!res.writableEnded) res.end();
    });
  }
}
