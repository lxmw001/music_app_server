import { Controller, Post, Logger } from '@nestjs/common';
import { CountrySearchScheduler } from './country-search.scheduler';

@Controller('admin/trigger')
export class CountrySearchController {
  private readonly logger = new Logger(CountrySearchController.name);

  constructor(
    private readonly countrySearchScheduler: CountrySearchScheduler,
  ) {}

  @Post('country-searches')
  async triggerCountrySearches() {
    this.logger.log('Manual trigger: country searches');
    await this.countrySearchScheduler.populateCountrySearches();
    return { success: true, message: 'Country search population triggered' };
  }
}
