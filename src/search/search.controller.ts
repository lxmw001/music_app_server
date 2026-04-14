import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/firebase-auth.guard';
import { SearchService, SearchResults } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';

@UseGuards(FirebaseAuthGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@Query() dto: SearchQueryDto): Promise<SearchResults> {
    return this.searchService.search(dto.q);
  }
}
