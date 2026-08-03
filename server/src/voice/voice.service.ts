import { Injectable, Logger } from '@nestjs/common';
import { WhisperService } from '../whisper/whisper.service';
import { type EffortLevel } from '../claude/claude.service';
import { AgentRuntimeService } from '../agent/agent-runtime.service';
import { AgentRuntimeError, type AgentHarness } from '../agent/agent.types';
import { PiperService } from '../piper/piper.service';
import { SessionService } from '../session/session.service';
import { JobsService } from '../jobs/jobs.service';
import { getProfileConfig } from '../profiles';
import { copyFile, unlink } from 'fs/promises';
import { join } from 'path';
import { AUDIO_DIR, assistantAudioFilename } from '../audio/audio.constants';

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    private readonly whisperService: WhisperService,
    private readonly agentRuntime: AgentRuntimeService,
    private readonly piperService: PiperService,
    private readonly sessionService: SessionService,
    private readonly jobsService: JobsService,
  ) {}

  // Fire-and-forget background processing. The controller has already returned
  // 202 to the client and the UI is listening on /api/events for state changes.
  processInBackground(
    audioFilePath: string,
    sessionId: string,
    harness: AgentHarness,
    skill: string | undefined,
    effort: EffortLevel | undefined,
    model: string | undefined,
  ): void {
    this.run(audioFilePath, sessionId, harness, skill, effort, model).catch((err) => {
      this.logger.error(`Background job failed for session ${sessionId}:`, err);
    });
  }

  private async run(
    audioFilePath: string,
    sessionId: string,
    harness: AgentHarness,
    skill: string | undefined,
    effort: EffortLevel | undefined,
    model: string | undefined,
  ): Promise<void> {
    // Track when the agent call began for the fallback timeout explanation.
    let agentStartedAt: number | null = null;
    let agentTimeoutMs = 600_000;
    try {
      // Look up the session up-front so we can pass the profile's whisper
      // prompt (vocabulary bias) to transcription. If the session was deleted
      // mid-flight we'll fail cleanly below.
      const session = this.sessionService.getSession(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }
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
      agentTimeoutMs = config.timeoutMs;

      // Step 1: Whisper
      this.logger.log(
        `Transcribing for session ${sessionId} (whisperPrompt=${whisperPrompt ? 'profile' : 'none'}, timeoutMs=${whisperTimeoutMs})...`,
      );
      const transcription = await this.whisperService.transcribe(
        audioFilePath,
        whisperPrompt,
        whisperTimeoutMs,
      );
      this.logger.log(`Transcription: ${transcription}`);

      // Persist the unmodified transcription, not the skill-prefixed prompt
      // sent to the selected agent runtime.
      const userMessage = this.sessionService.addMessage(
        sessionId,
        'user',
        transcription,
      );

      // Whisper done → entering the selected agent runtime. Surface the user's turn now (UI
      // renders it immediately) and advance the stage so the dot/label
      // reflects what's actually running.
      this.jobsService.emitIntermediate({
        sessionId,
        harness,
        state: 'processing',
        stage: 'agent',
        userMessage,
      });

      // If a skill is selected in the UI, inject the hint on every turn.
      // "Auto" (empty selection) sends the transcription as-is. Per-turn
      // injection lets the user switch skills mid-session (e.g. Bob's
      // one-shot routines) without starting a new session.
      const currentPrompt = skill
        ? `Apply the "${skill}" skill to this turn. ${transcription}`
        : transcription;
      const promptForAgent = recoveringPi
        ? this.sessionService.buildRecoveryPrompt(
            sessionId,
            userMessage.id,
            currentPrompt,
          )
        : currentPrompt;

      // Step 2: agent runtime
      this.logger.log(
        `${harness} (skill=${skill ?? 'none'}, effort=${effort ?? 'default'}, model=${model ?? 'profile'}, resume=${Boolean(continuation)}, recovery=${recoveringPi})...`,
      );
      agentStartedAt = Date.now();
      const agentResult = await this.agentRuntime.run({
        userMessage: promptForAgent,
        harness,
        profile,
        config,
        mcpConfigPath: config.mcpConfigPath,
        continuation,
        effort,
        model,
      });

      if (
        agentResult.continuation &&
        (agentResult.continuation.sessionId !== continuation?.sessionId ||
          agentResult.continuation.harness !== continuation?.harness)
      ) {
        this.sessionService.updateAgentContinuation(
          sessionId,
          agentResult.continuation.harness,
          agentResult.continuation.sessionId,
        );
      }
      if (recoveringPi && !agentResult.continuation) {
        this.sessionService.clearAgentRecovery(sessionId);
      }

      const assistantMessage = this.sessionService.addMessage(
        sessionId,
        'assistant',
        agentResult.displayText,
        agentResult.usage,
      );

      // Agent done → entering Piper. Stage transition keeps the SSE socket
      // active and gives the UI an accurate "Speaking…" indicator.
      this.jobsService.emitIntermediate({
        sessionId,
        harness,
        state: 'processing',
        stage: 'piper',
      });

      // Step 3: Piper — name the output deterministically so the client can
      // build /api/voice/audio/response-<id>.wav without a DB column.
      let audioFilename: string | null = null;
      try {
        const tmpAudioPath = await this.piperService.synthesize(
          agentResult.speechText,
          piperModelPath,
        );
        if (tmpAudioPath) {
          const targetName = assistantAudioFilename(assistantMessage.id);
          const targetPath = join(AUDIO_DIR, targetName);
          await copyFile(tmpAudioPath, targetPath);
          await unlink(tmpAudioPath).catch(() => {});
          audioFilename = targetName;
        }
      } catch (err) {
        this.logger.error(
          `Piper failed for session ${sessionId} (text-only response):`,
          err,
        );
      }

      this.jobsService.complete(sessionId, harness, {
        userMessage,
        assistantMessage,
        audioFilename,
        usage: this.sessionService.getSessionUsage(sessionId),
      });
    } catch (err) {
      this.logger.error(`Job error for session ${sessionId}:`, err);

      // Persist a failed-turn marker so the gap is explained on a later visit,
      // instead of the thread silently showing only the user's message. A
      // Agent work that ran to its timeout gets a timeout-specific note.
      const timedOut =
        (err instanceof AgentRuntimeError && err.kind === 'timeout') ||
        (agentStartedAt !== null &&
          Date.now() - agentStartedAt >= agentTimeoutMs - 1000);
      const note = timedOut
        ? `⚠️ This turn timed out after ${Math.round(agentTimeoutMs / 60_000)} minutes — no response was produced. Try again, or send a shorter/simpler request.`
        : `⚠️ This turn failed before a response was produced. Try again.`;
      let errorMessage;
      try {
        errorMessage = this.sessionService.addMessage(
          sessionId,
          'assistant',
          note,
          null,
          true,
        );
      } catch (persistErr) {
        // Session may have been deleted mid-flight — nothing to attach the
        // marker to. The SSE failure event below still fires.
        this.logger.error(
          `Failed to persist error marker for session ${sessionId}:`,
          persistErr,
        );
      }
      this.jobsService.fail(sessionId, harness, String(err), errorMessage);
    } finally {
      await unlink(audioFilePath).catch(() => {});
    }
  }
}
