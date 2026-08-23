import { Injectable, Logger } from '@nestjs/common';
import { WhisperService } from '../whisper/whisper.service';
import { type EffortLevel } from '../claude/claude.service';
import { AgentRuntimeService } from '../agent/agent-runtime.service';
import { AgentRuntimeError, type AgentHarness } from '../agent/agent.types';
import { PiperService } from '../piper/piper.service';
import { SessionService } from '../session/session.service';
import { JobsService } from '../jobs/jobs.service';
import { AgentWorkService } from '../agent-work/agent-work.service';
import { getProfileConfig } from '../profiles';
import { copyFile, unlink } from 'fs/promises';
import { join } from 'path';
import {
  AUDIO_DIR,
  agentWorkAudioFilename,
  assistantAudioFilename,
} from '../audio/audio.constants';

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    private readonly whisperService: WhisperService,
    private readonly agentRuntime: AgentRuntimeService,
    private readonly piperService: PiperService,
    private readonly sessionService: SessionService,
    private readonly jobsService: JobsService,
    private readonly agentWorkService: AgentWorkService,
  ) {}

  // Fire-and-forget background processing. The controller has already returned
  // 202 to the client and the UI is listening on /api/events for state changes.
  processInBackground(
    audioFilePath: string,
    sessionId: string,
    jobId: string,
    harness: AgentHarness,
    skill: string | undefined,
    effort: EffortLevel | undefined,
    model: string | undefined,
  ): void {
    this.run(
      audioFilePath,
      sessionId,
      jobId,
      harness,
      skill,
      effort,
      model,
    ).catch((err) => {
      this.logger.error(`Background job failed for session ${sessionId}:`, err);
    });
  }

  private async run(
    audioFilePath: string,
    sessionId: string,
    jobId: string,
    harness: AgentHarness,
    skill: string | undefined,
    effort: EffortLevel | undefined,
    model: string | undefined,
  ): Promise<void> {
    const work = this.agentWorkService.forTurn(jobId);
    try {
      const session = this.sessionService.getSession(sessionId);
      if (!session) throw new Error(`Session ${sessionId} not found`);
      if (session.agent_harness !== harness) {
        throw new Error(
          `Harness mismatch: session uses '${session.agent_harness}', request uses '${harness}'.`,
        );
      }
      const recoveringPi =
        harness === 'pi' &&
        this.sessionService.isAgentRecoveryPending(sessionId);
      const continuation =
        !recoveringPi && session.agent_session_id
          ? { harness, sessionId: session.agent_session_id }
          : null;
      const profile = session.profile;
      const config = getProfileConfig(profile);
      const { whisperPrompt, whisperTimeoutMs, piperModelPath } = config;

      this.logger.log(
        `Transcribing for session ${sessionId} (whisperPrompt=${whisperPrompt ? 'profile' : 'none'}, timeoutMs=${whisperTimeoutMs})...`,
      );
      const transcription = await this.whisperService.transcribe(
        audioFilePath,
        whisperPrompt,
        whisperTimeoutMs,
      );
      this.logger.log(`Transcription: ${transcription}`);

      const userMessage = this.sessionService.addMessage(
        sessionId,
        'user',
        transcription,
      );
      this.agentWorkService.setSummary(work.id, transcription);
      this.agentWorkService.enterAgent(work.id);
      this.jobsService.emitIntermediate({
        sessionId,
        harness,
        jobId,
        state: 'processing',
        stage: 'agent',
        userMessage,
      });

      const currentPrompt = skill
        ? `Apply the \"${skill}\" skill to this turn. ${transcription}`
        : transcription;
      const promptForAgent = recoveringPi
        ? this.sessionService.buildRecoveryPrompt(
            sessionId,
            userMessage.id,
            currentPrompt,
          )
        : currentPrompt;
      const prepared = this.agentWorkService.prepare(
        work.id,
        promptForAgent,
        continuation,
      );

      this.logger.log(
        `${harness} (skill=${skill ?? 'none'}, effort=${effort ?? 'default'}, model=${model ?? 'profile'}, resume=${Boolean(prepared.continuation)}, recovery=${recoveringPi})...`,
      );
      const run = await this.agentRuntime.start({
        userMessage: prepared.prompt,
        harness,
        profile,
        config: {
          ...config,
          writeRoots: JSON.parse(prepared.work.write_roots_json) as string[],
        },
        mcpConfigPath: config.mcpConfigPath,
        continuation: prepared.continuation,
        effort,
        model,
      });
      try {
        this.agentWorkService.attachRun(work.id, run);
      } catch (error) {
        if (run.terminate) {
          try {
            await run.terminate();
          } catch (cleanupError) {
            throw new AgentRuntimeError(
              'cleanup_unverified',
              `Agent process identity could not be persisted and cleanup could not be verified: ${String(cleanupError)}`,
              cleanupError,
            );
          }
        }
        throw error;
      }
      run.activate?.();
      const agentResult = await run.result;
      const completion = this.agentWorkService.claimCompletion(work.id);
      if (!completion) return;
      const terminal = this.agentWorkService.finishSuccess(
        work.id,
        agentResult,
        null,
        false,
      );
      if (!terminal.committed || !terminal.message) return;
      if (!terminal.wasBackground) {
        this.jobsService.emitIntermediate({
          sessionId,
          harness,
          jobId,
          state: 'processing',
          stage: 'piper',
        });
      }

      let temporaryAudioPath: string | null = null;
      try {
        temporaryAudioPath = await this.piperService.synthesize(
          agentResult.speechText,
          piperModelPath,
        );
      } catch (error) {
        this.logger.error(
          `Piper failed for session ${sessionId} (text-only response):`,
          error,
        );
      }

      let stagedAudioFilename: string | null = null;
      if (temporaryAudioPath) {
        const targetName = agentWorkAudioFilename(work.id);
        try {
          await copyFile(temporaryAudioPath, join(AUDIO_DIR, targetName));
          stagedAudioFilename = targetName;
        } catch (error) {
          this.logger.error(
            `Could not stage Agent Work audio for session ${sessionId}:`,
            error,
          );
        }
      }


      let audioFilename: string | null = null;
      if (temporaryAudioPath) {
        const targetName = assistantAudioFilename(terminal.message.id);
        try {
          await copyFile(temporaryAudioPath, join(AUDIO_DIR, targetName));
          audioFilename = targetName;
        } catch (error) {
          this.logger.error(
            `Could not persist response audio for session ${sessionId}:`,
            error,
          );
        }
        await unlink(temporaryAudioPath).catch(() => {});
      }
      this.agentWorkService.publishSuccess(
        work.id,
        stagedAudioFilename,
        terminal.wasBackground,
      );
      if (terminal.wasBackground) return;

      this.jobsService.complete(jobId, {
        userMessage,
        assistantMessage: terminal.message,
        audioFilename,
        usage: this.sessionService.getSessionUsage(sessionId),
        agentWork: this.agentWorkService.get(work.id),
      });
    } catch (error) {
      this.logger.error(`Job error for session ${sessionId}:`, error);
      if (
        error instanceof AgentRuntimeError &&
        error.kind === 'cleanup_unverified'
      ) {
        this.agentWorkService.markOrphaned(work.id, String(error));
        return;
      }
      const timedOut =
        error instanceof AgentRuntimeError && error.kind === 'timeout';
      const note = timedOut
        ? `This Agent Work run timed out without producing a response.`
        : `This Agent Work run failed before producing a response.`;
      await this.agentWorkService.finishFailure(
        work.id,
        timedOut ? 'timed_out' : 'failed',
        note,
        String(error),
      );
    } finally {
      await unlink(audioFilePath).catch(() => {});
    }
  }
}
