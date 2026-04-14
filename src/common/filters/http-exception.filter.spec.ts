import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { ArgumentsHost } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function createMockArgumentsHost(url = '/test-path') {
  const jsonMock = jest.fn();
  const statusMock = jest.fn().mockReturnValue({ json: jsonMock });
  const response = { status: statusMock };
  const request = { url };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, statusMock, jsonMock };
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  it('returns correct statusCode and message for HttpException (NotFoundException)', () => {
    const { host, statusMock, jsonMock } = createMockArgumentsHost();
    const exception = new NotFoundException('Song not found');

    filter.catch(exception, host);

    expect(statusMock).toHaveBeenCalledWith(404);
    const body = jsonMock.mock.calls[0][0];
    expect(body.statusCode).toBe(404);
    expect(body.message).toBeDefined();
  });

  it('returns statusCode 500 and "Internal server error" for non-HttpException errors', () => {
    const { host, statusMock, jsonMock } = createMockArgumentsHost();
    const exception = new Error('Something went wrong');

    filter.catch(exception, host);

    expect(statusMock).toHaveBeenCalledWith(500);
    const body = jsonMock.mock.calls[0][0];
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe('Internal server error');
  });

  it('passes message array through for BadRequestException with array message', () => {
    const { host, jsonMock } = createMockArgumentsHost();
    const messages = ['field must not be empty', 'field must be a string'];
    const exception = new BadRequestException({ message: messages, error: 'Bad Request', statusCode: 400 });

    filter.catch(exception, host);

    const body = jsonMock.mock.calls[0][0];
    expect(body.message).toEqual(messages);
  });

  it('includes a valid ISO 8601 timestamp', () => {
    const { host, jsonMock } = createMockArgumentsHost();
    filter.catch(new NotFoundException(), host);

    const { timestamp } = jsonMock.mock.calls[0][0];
    expect(new Date(timestamp).toString()).not.toBe('Invalid Date');
  });

  it('sets path to request.url', () => {
    const { host, jsonMock } = createMockArgumentsHost('/test-path');
    filter.catch(new NotFoundException(), host);

    const body = jsonMock.mock.calls[0][0];
    expect(body.path).toBe('/test-path');
  });
});
