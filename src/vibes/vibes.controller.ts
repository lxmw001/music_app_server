import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { VibesService } from './vibes.service';
import { VibeItemDto } from './dto/vibe-item.dto';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { AdminGuard } from '../sync/admin.guard';

@Controller('vibes')
export class VibesController {
  constructor(private readonly vibesService: VibesService) {}

  @Get()
  findAll(): Promise<VibeItemDto[]> {
    return this.vibesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<VibeItemDto> {
    return this.vibesService.findOne(id);
  }

  @Post()
  @UseGuards(FirebaseAuthGuard, AdminGuard)
  create(@Body() body: Omit<VibeItemDto, 'id'>): Promise<VibeItemDto> {
    return this.vibesService.create(body);
  }

  @Patch(':id')
  @UseGuards(FirebaseAuthGuard, AdminGuard)
  update(@Param('id') id: string, @Body() body: Partial<Omit<VibeItemDto, 'id'>>): Promise<VibeItemDto> {
    return this.vibesService.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(FirebaseAuthGuard, AdminGuard)
  remove(@Param('id') id: string): Promise<void> {
    return this.vibesService.remove(id);
  }
}
