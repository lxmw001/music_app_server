import { Body, Controller, ForbiddenException, Post, Req, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { AuthenticatedRequest } from '../auth/interfaces/authenticated-request.interface';
import { VibeRequestDto } from './dto/vibe-request.dto';
import { VibeService } from './vibe.service';

@Controller('vibe')
@UseGuards(FirebaseAuthGuard)
export class VibeController {
  constructor(private readonly vibeService: VibeService) {}

  @Post('generate')
  async generate(@Req() req: AuthenticatedRequest, @Body() dto: VibeRequestDto) {
    if (!req.user.isPremium && !req.user.admin) {
      throw new ForbiddenException('Fast Mode requires a premium account');
    }
    return this.vibeService.generate(dto);
  }
}
