import { GeminiService } from './gemini.service';

// TODO: Rewrite tests for @google/genai SDK
describe('GeminiService', () => {
  it('initializes without API key', () => {
    delete process.env.GEMINI_API_KEY;
    const service = new GeminiService();
    expect(service).toBeDefined();
  });

  it('initializes with API key', () => {
    process.env.GEMINI_API_KEY = 'test-key';
    const service = new GeminiService();
    expect(service).toBeDefined();
  });
});
