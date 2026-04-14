import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { PlaylistsService } from './playlists.service';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { AddSongDto } from './dto/add-song.dto';
import { PlaylistResponseDto } from './dto/playlist-response.dto';

@UseGuards(FirebaseAuthGuard)
@Controller('playlists')
export class PlaylistsController {
  constructor(private readonly playlistsService: PlaylistsService) {}

  @Post()
  @HttpCode(201)
  create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreatePlaylistDto,
  ): Promise<PlaylistResponseDto> {
    return this.playlistsService.create(req.user.uid, dto);
  }

  @Get()
  findAll(
    @Request() req: AuthenticatedRequest,
  ): Promise<PlaylistResponseDto[]> {
    return this.playlistsService.findAllForUser(req.user.uid);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    return this.playlistsService.delete(id, req.user.uid);
  }

  @Post(':id/songs')
  addSong(
    @Param('id') id: string,
    @Body() dto: AddSongDto,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    return this.playlistsService.addSong(id, dto.songId, req.user.uid);
  }

  @Delete(':id/songs/:songId')
  @HttpCode(204)
  removeSong(
    @Param('id') id: string,
    @Param('songId') songId: string,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    return this.playlistsService.removeSong(id, songId, req.user.uid);
  }
}
