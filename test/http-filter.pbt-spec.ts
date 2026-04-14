// Feature: nestjs-project-tests, Property 6: HttpExceptionFilter response shape, statusCode round-trip, and timestamp validity

import * as fc from 'fast-check';
import { HttpException } from '@nestjs/common';
import { ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { arbHttpStatusCode, arbMessageString } from './shared/arbitraries';

function createMockHost(url = '/test') {
  const jsonMock = jest.fn();
  const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status: statusMock }),
      getRequest: () => ({ url }),
    }),
  } as unknown as ArgumentsHost;
  return { host, statusMock, jsonMock };
}

describe('HttpExceptionFilter — property-based tests', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  it('Property 6: for any HTTP status code (400-599) and message, response always has statusCode, message, timestamp', () => {
    fc.assert(
      fc.property(arbHttpStatusCode, arbMessageString, (statusCode: number, message: string) => {
        const { host, statusMock, jsonMock } = createMockHost();
        const exception = new HttpException(message, statusCode);

        filter.catch(exception, host);

        // statusCode field matches
        expect(statusMock).toHaveBeenCalledWith(statusCode);
        const body = jsonMock.mock.calls[0][0];

        // All three required fields present
        expect(body).toHaveProperty('statusCode');
        expect(body).toHaveProperty('message');
        expect(body).toHaveProperty('timestamp');

        // statusCode round-trip
        expect(body.statusCode).toBe(statusCode);

        // timestamp is valid ISO 8601
        expect(new Date(body.timestamp).toString()).not.toBe('Invalid Date');

        // Reset mocks for next iteration
        statusMock.mockClear();
        jsonMock.mockClear();
        statusMock.mockReturnValue({ json: jsonMock });
      }),
      { numRuns: 100 },
    );
  });
});
