import { Test, TestingModule } from '@nestjs/testing';
import { WhisperService } from './whisper.service';

describe('WhisperService', () => {
  let service: WhisperService;
  const previousMode = process.env.BOB_TEST_MODE;
  const previousTranscript = process.env.BOB_TEST_TRANSCRIPT;
  const previousModelPath = process.env.BOB_WHISPER_MODEL_PATH;

  beforeEach(async () => {
    delete process.env.BOB_TEST_MODE;
    delete process.env.BOB_TEST_TRANSCRIPT;
    delete process.env.BOB_WHISPER_MODEL_PATH;
    const module: TestingModule = await Test.createTestingModule({
      providers: [WhisperService],
    }).compile();
    service = module.get<WhisperService>(WhisperService);
  });

  afterAll(() => {
    if (previousMode === undefined) delete process.env.BOB_TEST_MODE;
    else process.env.BOB_TEST_MODE = previousMode;
    if (previousTranscript === undefined) delete process.env.BOB_TEST_TRANSCRIPT;
    else process.env.BOB_TEST_TRANSCRIPT = previousTranscript;
    if (previousModelPath === undefined) delete process.env.BOB_WHISPER_MODEL_PATH;
    else process.env.BOB_WHISPER_MODEL_PATH = previousModelPath;
  });

  it('returns a deterministic transcript in offline test mode', async () => {
    process.env.BOB_TEST_MODE = 'offline';
    process.env.BOB_TEST_TRANSCRIPT = 'Configured offline transcript';
    await expect(service.transcribe('/file/does/not/exist.wav')).resolves.toBe(
      'Configured offline transcript',
    );
  });

  it('requires an explicit Whisper model outside offline mode', async () => {
    await expect(service.transcribe('/file/does/not/exist.wav')).rejects.toThrow(
      'BOB_WHISPER_MODEL_PATH',
    );
  });

  describe('normalizeTranscript', () => {
    const normalize = WhisperService.normalizeTranscript;

    it('turns a spoken long-dash pause into a comma', () => {
      expect(normalize('do this — but check that first')).toBe(
        'do this, but check that first',
      );
      expect(normalize('one – two ― three')).toBe('one, two, three');
    });

    it('drops a leading list-style dash', () => {
      expect(normalize('- the first thing we discussed')).toBe(
        'the first thing we discussed',
      );
      expect(normalize('— another aside')).toBe('another aside');
    });

    it('collapses a word-adjacent long dash but preserves hyphens', () => {
      expect(normalize('wait—what')).toBe('wait what');
      expect(normalize('the self-hosted model is fine')).toBe(
        'the self-hosted model is fine',
      );
    });

    it('does not produce doubled commas or stray spaces', () => {
      expect(normalize('a — , b')).toBe('a, b');
      expect(normalize('  padded  —  text  ')).toBe('padded, text');
    });
  });
});
