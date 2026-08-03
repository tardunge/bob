import { VoiceService } from './voice.service';
import { DEFAULT_PROFILE } from '../profiles';

describe('VoiceService restart recovery', () => {
  it('starts Pi fresh and prepends persisted recovery context', async () => {
    const whisper = { transcribe: jest.fn().mockResolvedValue('new request') };
    const agentRuntime = {
      run: jest.fn().mockResolvedValue({
        displayText: 'recovered response',
        speechText: 'recovered response',
        continuation: { harness: 'pi', sessionId: '/state/fresh.jsonl' },
        usage: null,
      }),
    };
    const piper = { synthesize: jest.fn().mockResolvedValue(null) };
    const sessionService = {
      getSession: jest.fn().mockReturnValue({
        id: 'session-1',
        profile: DEFAULT_PROFILE,
        agent_harness: 'pi',
        agent_session_id: '/state/stale.jsonl',
      }),
      isAgentRecoveryPending: jest.fn().mockReturnValue(true),
      addMessage: jest
        .fn()
        .mockReturnValueOnce({ id: 41, role: 'user', content: 'new request' })
        .mockReturnValueOnce({
          id: 42,
          role: 'assistant',
          content: 'recovered response',
        }),
      buildRecoveryPrompt: jest.fn().mockReturnValue('recovery prompt'),
      updateAgentContinuation: jest.fn(),
      clearAgentRecovery: jest.fn(),
      getSessionUsage: jest.fn().mockReturnValue({ cumulative: {}, latest: null }),
    };
    const jobs = {
      emitIntermediate: jest.fn(),
      complete: jest.fn(),
      fail: jest.fn(),
    };
    const service = new VoiceService(
      whisper as never,
      agentRuntime as never,
      piper as never,
      sessionService as never,
      jobs as never,
    );

    // The test exercises the private background step directly because the
    // public entry point is intentionally fire-and-forget.
    const run = Reflect.get(service, 'run') as (
      audio: string,
      session: string,
      harness: 'pi',
      skill?: string,
      effort?: undefined,
      model?: undefined,
    ) => Promise<void>;
    await run.call(
      service,
      '/tmp/bob-recovery-test-missing.wav',
      'session-1',
      'pi',
    );

    expect(sessionService.buildRecoveryPrompt).toHaveBeenCalledWith(
      'session-1',
      41,
      'new request',
    );
    expect(agentRuntime.run).toHaveBeenCalledWith(
      expect.objectContaining({
        harness: 'pi',
        continuation: null,
        userMessage: 'recovery prompt',
      }),
    );
    expect(sessionService.updateAgentContinuation).toHaveBeenCalledWith(
      'session-1',
      'pi',
      '/state/fresh.jsonl',
    );
    expect(jobs.complete).toHaveBeenCalled();
    expect(jobs.fail).not.toHaveBeenCalled();
  });
});
