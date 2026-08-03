import { Test, TestingModule } from '@nestjs/testing';
import { ClaudeService } from './claude.service';

describe('ClaudeService', () => {
  let service: ClaudeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ClaudeService],
    }).compile();

    service = module.get<ClaudeService>(ClaudeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });


  describe('extractUsage - context window denominator', () => {
    // A configured model's known window is more reliable than an intermediary
    // or provider response that reports only a smaller base window.
    const call = (cli: unknown, model?: string | null) =>
      (service as unknown as {
        extractUsage: (c: unknown, m?: string | null) => { contextWindow: number } | null;
      }).extractUsage(cli, model);

    const cliWith = (reportedWindow: number) => ({
      usage: {
        input_tokens: 3000,
        cache_read_input_tokens: 500_000,
        cache_creation_input_tokens: 40_000,
      },
      modelUsage: {
        'claude-opus-4-8': { contextWindow: reportedWindow },
      },
    });

    it('uses the known 1M window for opus even when the proxy reports 200k', () => {
      expect(call(cliWith(200_000), 'claude-opus-4-8')?.contextWindow).toBe(
        1_000_000,
      );
    });

    it('falls back to the CLI-reported max for a model with no known window', () => {
      expect(call(cliWith(200_000), 'claude-sonnet-5')?.contextWindow).toBe(
        200_000,
      );
    });

    it('falls back to 200k when neither a known nor a reported window exists', () => {
      expect(
        call({ usage: { input_tokens: 1 }, modelUsage: {} }, null)
          ?.contextWindow,
      ).toBe(200_000);
    });

    it('returns null usage when the CLI reports no usage block', () => {
      expect(call({}, 'claude-opus-4-8')).toBeNull();
    });
  });

  describe('cleanForDisplay - unit', () => {
    it('should remove ANSI escape codes', () => {
      const dirty = '\x1b[32mHello\x1b[0m World';
      const cleaned = service.cleanForDisplay(dirty);
      expect(cleaned).toBe('Hello World');
    });

    it('should preserve markdown formatting', () => {
      const input = 'This is **bold** and `code`';
      const cleaned = service.cleanForDisplay(input);
      expect(cleaned).toBe('This is **bold** and `code`');
    });

    it('should preserve code blocks', () => {
      const input = 'Run this:\n```bash\nnpm install\n```';
      const cleaned = service.cleanForDisplay(input);
      expect(cleaned).toBe('Run this:\n```bash\nnpm install\n```');
    });
  });

  describe('cleanForSpeech - unit', () => {
    it('should remove ANSI escape codes', () => {
      const dirty = '\x1b[32mHello\x1b[0m World';
      const cleaned = service.cleanForSpeech(dirty);
      expect(cleaned).toBe('Hello World');
    });

    it('should remove markdown bold formatting', () => {
      const dirty = 'This is **bold** text';
      const cleaned = service.cleanForSpeech(dirty);
      expect(cleaned).toBe('This is bold text');
    });

    it('should remove inline code backticks', () => {
      const dirty = 'Run `npm install` command';
      const cleaned = service.cleanForSpeech(dirty);
      expect(cleaned).toBe('Run npm install command');
    });

    it('should remove code blocks entirely', () => {
      const dirty = 'Here is the code:\n```bash\nnpm install\n```\nThat should work.';
      const cleaned = service.cleanForSpeech(dirty);
      expect(cleaned).toBe('Here is the code:\n\nThat should work.');
    });

    it('should trim whitespace', () => {
      const dirty = '  Hello World  \n';
      const cleaned = service.cleanForSpeech(dirty);
      expect(cleaned).toBe('Hello World');
    });
  });
});
