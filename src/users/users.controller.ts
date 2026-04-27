import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { UsersService } from './users.service';

@UseGuards(FirebaseAuthGuard)
@Controller('users/me')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
}
