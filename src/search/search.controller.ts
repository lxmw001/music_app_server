import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { SearchService, SearchResults } from './search.service';
import { SearchQueryDto } from './dto/search-query.dto';

@UseGuards(OptionalAuthGuard)
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@Query() dto: SearchQueryDto): Promise<SearchResults> {
    return this.searchService.search(dto.q);
  }

  @Get('ai')
  aiSearch(@Query() dto: SearchQueryDto): Promise<any> {
    return this.searchService.aiSearch(dto.q);
  }
}
