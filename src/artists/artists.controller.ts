import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { ArtistsService } from './artists.service';
import { PaginationDto } from '../songs/dto/pagination.dto';
import { ArtistResponseDto } from './dto/artist-response.dto';
import { SongResponseDto } from '../songs/dto/song-response.dto';
import { AlbumResponseDto } from '../albums/dto/album-response.dto';

@UseGuards(FirebaseAuthGuard)
@Controller('artists')
export class ArtistsController {
  constructor(private readonly artistsService: ArtistsService) {}

  @Get()
  findAll(@Query() pagination: PaginationDto): Promise<ArtistResponseDto[]> {
    return this.artistsService.findAll(pagination);
  }

  @Get(':id')
  findById(@Param('id') id: string): Promise<ArtistResponseDto> {
    return this.artistsService.findById(id);
  }

  @Get(':id/songs')
  findSongs(@Param('id') id: string): Promise<SongResponseDto[]> {
    return this.artistsService.findSongs(id);
  }

  @Get(':id/albums')
  findAlbums(@Param('id') id: string): Promise<AlbumResponseDto[]> {
    return this.artistsService.findAlbums(id);
  }
}
