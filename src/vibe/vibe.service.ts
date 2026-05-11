import { Injectable } from '@nestjs/common';
import { GeminiService } from '../sync/gemini.service';
import { VibeRequestDto } from './dto/vibe-request.dto';

@Injectable()
export class VibeService {
  constructor(private readonly gemini: GeminiService) {}

  async generate(dto: VibeRequestDto): Promise<{ queries: string[] }> {
    const queries = await this.gemini.generateVibeQueries(dto);
    return { queries };
  }
}
