import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { SongsService } from './songs.service';
import { PaginationDto } from './dto/pagination.dto';
import { SongResponseDto } from './dto/song-response.dto';

@UseGuards(FirebaseAuthGuard)
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
}
