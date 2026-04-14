import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { SuggestionsService } from './suggestions.service';
import { SuggestionQueryDto } from './dto/suggestion-query.dto';
import { SuggestionResultDto } from './dto/suggestion-result.dto';

@UseGuards(FirebaseAuthGuard)
@Controller('suggestions')
export class SuggestionsController {
  constructor(private readonly suggestionsService: SuggestionsService) {}

  @Get()
  suggest(@Query() dto: SuggestionQueryDto): Promise<SuggestionResultDto[]> {
    return this.suggestionsService.suggest(dto.q);
  }
}
