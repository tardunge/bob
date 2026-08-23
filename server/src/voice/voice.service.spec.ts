import { VoiceService } from './voice.service';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  AUDIO_DIR,
  agentWorkAudioFilename,
  assistantAudioFilename,
} from '../audio/audio.constants';
import { DEFAULT_PROFILE } from '../profiles';

describe('VoiceService restart recovery', () => {
  it('starts Pi fresh and prepends persisted recovery context', async () => {
    const whisper = { transcribe: jest.fn().mockResolvedValue('new request') };
    const result = {
      displayText: 'recovered response',
      speechText: 'recovered response',
      continuation: { harness: 'pi', sessionId: '/state/fresh.jsonl' },
      usage: null,
    };
    const activate = jest.fn();
    const agentRuntime = {
      start: jest.fn().mockResolvedValue({
        processIdentity: null,
        terminate: null,
        result: Promise.resolve(result),
        activate,
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
        .mockReturnValue({ id: 41, role: 'user', content: 'new request' }),
      buildRecoveryPrompt: jest.fn().mockReturnValue('recovery prompt'),
      getSessionUsage: jest.fn().mockReturnValue({ cumulative: {}, latest: null }),
    };
    const jobs = {
      emitIntermediate: jest.fn(),
      complete: jest.fn(),
    };
    const workRecord = {
      id: 'work-1',
      turn_id: 'turn-1',
      session_id: 'session-1',
      state: 'foreground',
      write_roots_json: '[]',
    };
    const agentWork = {
      forTurn: jest.fn().mockReturnValue(workRecord),
      enterAgent: jest.fn(),
      setSummary: jest.fn(),
      prepare: jest.fn().mockReturnValue({
        work: workRecord,
        prompt: 'recovery prompt',
        continuation: null,
      }),
      attachRun: jest.fn(),
      claimCompletion: jest
        .fn()
        .mockReturnValue({ ...workRecord, state: 'settling' }),
      finishSuccess: jest.fn().mockReturnValue({
        work: { ...workRecord, state: 'succeeded' },
        message: { id: 42, role: 'assistant', content: 'recovered response' },
        wasBackground: false,
        committed: true,
      }),
      publishSuccess: jest.fn(),
      get: jest.fn().mockReturnValue({
        ...workRecord,
        state: 'succeeded',
        write_roots: [],
        cancellable: false,
      }),
      finishFailure: jest.fn(),
    };
    const service = new VoiceService(
      whisper as never,
      agentRuntime as never,
      piper as never,
      sessionService as never,
      jobs as never,
      agentWork as never,
    );

    const run = Reflect.get(service, 'run') as (
      audio: string,
      session: string,
      jobId: string,
      harness: 'pi',
      skill?: string,
      effort?: undefined,
      model?: undefined,
    ) => Promise<void>;
    await run.call(
      service,
      '/tmp/bob-recovery-test-missing.wav',
      'session-1',
      'turn-1',
      'pi',
    );

    expect(sessionService.buildRecoveryPrompt).toHaveBeenCalledWith(
      'session-1',
      41,
      'new request',
    );
    expect(agentRuntime.start).toHaveBeenCalledWith(
      expect.objectContaining({
        harness: 'pi',
        continuation: null,
        userMessage: 'recovery prompt',
      }),
    );
    expect(agentWork.attachRun.mock.invocationCallOrder[0]).toBeLessThan(
      activate.mock.invocationCallOrder[0],
    );
    expect(agentWork.finishSuccess).toHaveBeenCalledWith(
      'work-1',
      result,
      null,
      false,
    );
    expect(agentWork.finishSuccess.mock.invocationCallOrder[0]).toBeLessThan(
      piper.synthesize.mock.invocationCallOrder[0],
    );
    expect(piper.synthesize.mock.invocationCallOrder[0]).toBeLessThan(
      agentWork.publishSuccess.mock.invocationCallOrder[0],
    );
    expect(jobs.complete).toHaveBeenCalled();
    expect(agentWork.finishFailure).not.toHaveBeenCalled();
  });

  it('stages successful Background Callback audio before terminal publication', async () => {
    mkdirSync(AUDIO_DIR, { recursive: true });
    const suffix = randomUUID();
    const inputPath = join(tmpdir(), `bob-voice-input-${suffix}.wav`);
    const piperPath = join(tmpdir(), `bob-voice-piper-${suffix}.wav`);
    writeFileSync(inputPath, 'input');
    writeFileSync(piperPath, 'audio');

    const result = {
      displayText: 'background response',
      speechText: 'background response',
      continuation: { harness: 'pi' as const, sessionId: '/state/new.jsonl' },
      usage: null,
    };
    const workRecord = {
      id: `work-${suffix}`,
      turn_id: `turn-${suffix}`,
      session_id: `session-${suffix}`,
      state: 'background',
      write_roots_json: '[]',
    };
    const message = {
      id: 43,
      role: 'assistant',
      content: result.displayText,
    };
    const whisper = { transcribe: jest.fn().mockResolvedValue('request') };
    const agentRuntime = {
      start: jest.fn().mockResolvedValue({
        processIdentity: null,
        terminate: null,
        result: Promise.resolve(result),
      }),
    };
    const piper = { synthesize: jest.fn().mockResolvedValue(piperPath) };
    const sessionService = {
      getSession: jest.fn().mockReturnValue({
        id: workRecord.session_id,
        profile: DEFAULT_PROFILE,
        agent_harness: 'pi',
        agent_session_id: '/state/current.jsonl',
      }),
      isAgentRecoveryPending: jest.fn().mockReturnValue(false),
      addMessage: jest
        .fn()
        .mockReturnValue({ id: 42, role: 'user', content: 'request' }),
      getSessionUsage: jest.fn().mockReturnValue({ cumulative: {}, latest: null }),
    };
    const jobs = {
      emitIntermediate: jest.fn(),
      complete: jest.fn(),
    };
    const agentWork = {
      forTurn: jest.fn().mockReturnValue(workRecord),
      enterAgent: jest.fn(),
      setSummary: jest.fn(),
      prepare: jest.fn().mockReturnValue({
        work: workRecord,
        prompt: 'request',
        continuation: { harness: 'pi', sessionId: '/state/current.jsonl' },
      }),
      attachRun: jest.fn(),
      claimCompletion: jest.fn().mockReturnValue(workRecord),
      finishSuccess: jest.fn().mockReturnValue({
        work: { ...workRecord, state: 'succeeded' },
        message,
        wasBackground: true,
        committed: true,
      }),
      publishSuccess: jest.fn(),
      get: jest.fn(),
      finishFailure: jest.fn(),
    };
    const service = new VoiceService(
      whisper as never,
      agentRuntime as never,
      piper as never,
      sessionService as never,
      jobs as never,
      agentWork as never,
    );
    const run = Reflect.get(service, 'run') as (
      audio: string,
      session: string,
      jobId: string,
      harness: 'pi',
    ) => Promise<void>;
    const callbackFilename = agentWorkAudioFilename(workRecord.id);
    const messageFilename = assistantAudioFilename(message.id);

    try {
      await run.call(
        service,
        inputPath,
        workRecord.session_id,
        workRecord.turn_id,
        'pi',
      );

      expect(agentWork.finishSuccess).toHaveBeenCalledWith(
        workRecord.id,
        result,
        null,
        false,
      );
      expect(agentWork.publishSuccess).toHaveBeenCalledWith(
        workRecord.id,
        callbackFilename,
        true,
      );
      expect(existsSync(join(AUDIO_DIR, callbackFilename))).toBe(true);
      expect(existsSync(join(AUDIO_DIR, messageFilename))).toBe(true);
      expect(jobs.complete).not.toHaveBeenCalled();
      expect(agentWork.finishFailure).not.toHaveBeenCalled();
    } finally {
      for (const path of [
        inputPath,
        piperPath,
        join(AUDIO_DIR, callbackFilename),
        join(AUDIO_DIR, messageFilename),
      ]) {
        if (existsSync(path)) unlinkSync(path);
      }
    }
  });
});
