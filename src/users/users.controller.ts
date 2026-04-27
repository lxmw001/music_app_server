import {
  Body,
  Controller,
  Get,
  Post,
  Delete,
  HttpCode,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { UsersService } from './users.service';
import { PlaylistsService } from '../playlists/playlists.service';
import { CreatePlaylistDto } from '../playlists/dto/create-playlist.dto';
import { AddSongDto } from '../playlists/dto/add-song.dto';

@UseGuards(FirebaseAuthGuard)
@Controller('users/me')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly playlistsService: PlaylistsService,
  ) {}

  // ── Profile ────────────────────────────────────────────────────────────────

  @Get()
  getProfile(@Req() req: AuthenticatedRequest) {
    return this.usersService.getProfile(req.user.uid);
  }

  // ── Liked Songs ────────────────────────────────────────────────────────────

  @Get('liked-songs')
  getLikedSongs(@Req() req: AuthenticatedRequest) {
    return this.usersService.getLikedSongs(req.user.uid);
  }

  @Get('liked-songs/:songId')
  isSongLiked(@Req() req: AuthenticatedRequest, @Param('songId') songId: string) {
    return this.usersService.isSongLiked(req.user.uid, songId);
  }

  @Post('liked-songs/:songId')
  likeSong(@Req() req: AuthenticatedRequest, @Param('songId') songId: string) {
    return this.usersService.likeSong(req.user.uid, songId);
  }

  @Delete('liked-songs/:songId')
  unlikeSong(@Req() req: AuthenticatedRequest, @Param('songId') songId: string) {
    return this.usersService.unlikeSong(req.user.uid, songId);
  }

  // ── Downloaded Songs ───────────────────────────────────────────────────────

  @Get('downloads')
  getDownloads(@Req() req: AuthenticatedRequest) {
    return this.usersService.getDownloadedSongs(req.user.uid);
  }

  @Post('downloads/:songId')
  markDownloaded(@Req() req: AuthenticatedRequest, @Param('songId') songId: string) {
    return this.usersService.markDownloaded(req.user.uid, songId);
  }

  @Delete('downloads/:songId')
  removeDownload(@Req() req: AuthenticatedRequest, @Param('songId') songId: string) {
    return this.usersService.removeDownload(req.user.uid, songId);
  }

  // ── Playlists ──────────────────────────────────────────────────────────────

  @Get('playlists')
  getPlaylists(@Req() req: AuthenticatedRequest) {
    return this.playlistsService.findAllForUser(req.user.uid);
  }

  @Post('playlists')
  @HttpCode(201)
  createPlaylist(@Req() req: AuthenticatedRequest, @Body() dto: CreatePlaylistDto) {
    return this.playlistsService.create(req.user.uid, dto);
  }

  @Get('playlists/:id')
  getPlaylist(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.playlistsService.findById(id, req.user.uid);
  }

  @Get('playlists/:id/songs')
  getPlaylistSongs(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.playlistsService.getSongs(id, req.user.uid);
  }

  @Post('playlists/:id/songs')
  addSongToPlaylist(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: AddSongDto,
  ) {
    return this.playlistsService.addSong(id, dto.songId, req.user.uid);
  }

  @Delete('playlists/:id/songs/:songId')
  @HttpCode(204)
  removeSongFromPlaylist(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Param('songId') songId: string,
  ) {
    return this.playlistsService.removeSong(id, songId, req.user.uid);
  }

  @Delete('playlists/:id')
  @HttpCode(204)
  deletePlaylist(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.playlistsService.delete(id, req.user.uid);
  }
}
