import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { AlbumsService } from './albums.service';
import { PaginationDto } from '../songs/dto/pagination.dto';
import { AlbumResponseDto } from './dto/album-response.dto';

@UseGuards(FirebaseAuthGuard)
@Controller('albums')
export class AlbumsController {
  constructor(private readonly albumsService: AlbumsService) {}

  @Get()
  findAll(@Query() pagination: PaginationDto): Promise<AlbumResponseDto[]> {
    return this.albumsService.findAll(pagination);
  }

  @Get(':id')
  findById(@Param('id') id: string): Promise<AlbumResponseDto> {
    return this.albumsService.findById(id);
  }
}
