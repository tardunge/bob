import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { parse } from 'path';
import type {
  AgentHarness,
  AgentTurnResult,
  ManagedAgentRun,
  ManagedProcessIdentity,
} from '../agent/agent.types';
import { AgentRuntimeService } from '../agent/agent-runtime.service';
import { DatabaseService } from '../database/database.service';
import { canonicalizeWriteRoots, getProfileConfig } from '../profiles';
import { terminateProcessGroup } from '../process/process-supervisor';
import { SessionService } from '../session/session.service';
import type { Message } from '../session/session.dto';
import {
  AgentWorkAdmissionError,
  AgentWorkStore,
} from './agent-work.store';
import type {
  AgentWorkAdmission,
  AgentWorkEvent,
  AgentWorkProjection,
  AgentWorkRecord,
  AgentWorkState,
  BackgroundCallbackRecord,
  PreparedAgentWork,
} from './agent-work.types';
import { isTerminalAgentWorkState } from './agent-work.types';

const PROMOTION_MS = 120_000;
const CALLBACK_BATCH_LIMIT = 20;

interface TerminalResult {
  work: AgentWorkRecord;
  message: Message | null;
  wasBackground: boolean;
  committed: boolean;
}

@Injectable()
export class AgentWorkService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(AgentWorkService.name);
  private readonly events$ = new Subject<AgentWorkEvent>();
  private readonly promotionTimers = new Map<string, NodeJS.Timeout>();
  private readonly deadlineTimers = new Map<string, NodeJS.Timeout>();
  private readonly runs = new Map<string, ManagedAgentRun>();

  constructor(
    private readonly database: DatabaseService,
    private readonly runtimes: AgentRuntimeService,
    private readonly sessions: SessionService,
  ) {}

  private get db() {
    return this.database.getDatabase();
  }

  private get store(): AgentWorkStore {
    return new AgentWorkStore(this.db);
  }

  async onApplicationBootstrap(): Promise<void> {
    this.db
      .prepare(
        `UPDATE background_callbacks
         SET delivery_state = 'pending', claim_turn_id = NULL
         WHERE delivery_state = 'claimed'`,
      )
      .run();
    this.db
      .prepare(
        `UPDATE agent_work
         SET stage = NULL, updated_at = datetime('now')
         WHERE state = 'succeeded' AND stage = 'piper'`,
      )
      .run();

    for (const work of this.store.active()) {
      const identity = this.identityFor(work);
      try {
        if (!identity && work.stage !== 'whisper') {
          throw new Error('Managed process identity is unavailable.');
        }
        if (identity) await terminateProcessGroup(identity, true);
        await this.finishFailure(
          work.id,
          'interrupted',
          'This Agent Work run was interrupted when the Bob server restarted.',
          'Bob server restarted.',
        );
      } catch (error) {
        const reason = `Startup could not safely reconcile the managed process: ${String(error)}`;
        this.store.markOrphaned(work.id, reason);
        this.logger.error(reason);
      }
    }
  }

  async onApplicationShutdown(): Promise<void> {
    const failures: unknown[] = [];
    for (const work of this.store.active()) {
      try {
        await this.terminateOwnedProcess(work, !this.runs.has(work.id));
        await this.finishFailure(
          work.id,
          'interrupted',
          'This Agent Work run was interrupted when the Bob server stopped.',
          'Bob server stopped.',
        );
      } catch (error) {
        this.store.markOrphaned(
          work.id,
          `Shutdown could not verify process termination: ${String(error)}`,
        );
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        'Bob shutdown could not verify every managed Agent Work process group stopped.',
      );
    }
  }

  admitTurn(sessionId: string, harness: AgentHarness): AgentWorkAdmission {
    const session = this.sessions.getSession(sessionId);
    if (!session) throw new NotFoundException('Session not found');
    const config = getProfileConfig(session.profile);
    const canonicalWriteRoots = canonicalizeWriteRoots(
      config.writeRoots,
      config.cwd,
      `profile '${session.profile}' admission`,
    );
    const capabilities = this.runtimes.capabilitiesFor(harness);
    const hasUnrestrictedExtensions =
      harness === 'pi' && config.piExtensions.length > 0;
    const enforcedWriteRoots =
      capabilities.enforcedWriteRoots && !hasUnrestrictedExtensions;
    const writeRoots = hasUnrestrictedExtensions
      ? [parse(config.cwd).root]
      : canonicalWriteRoots;
    const backgroundSupported =
      capabilities.background &&
      capabilities.recursiveTermination &&
      enforcedWriteRoots;
    try {
      return this.store.admit(
        sessionId,
        harness,
        config.timeoutMs,
        writeRoots,
        backgroundSupported,
        enforcedWriteRoots,
      );
    } catch (error) {
      if (error instanceof AgentWorkAdmissionError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  hasForeground(sessionId: string): boolean {
    return this.store.hasForeground(sessionId);
  }

  forTurn(turnId: string): AgentWorkRecord {
    const work = this.store.forTurn(turnId);
    if (!work) throw new NotFoundException(`Agent Work for Turn ${turnId} not found`);
    return work;
  }

  get(id: string): AgentWorkProjection {
    const work = this.store.get(id);
    if (!work) throw new NotFoundException(`Agent Work ${id} not found`);
    return this.store.project(work);
  }

  listForSession(sessionId: string): AgentWorkProjection[] {
    return this.store.listForSession(sessionId);
  }

  listTerminalAfter(sequence: number): AgentWorkProjection[] {
    return this.store.listTerminalAfter(sequence);
  }

  maxTerminalSequence(): number {
    return this.store.maxTerminalSequence();
  }

  enterAgent(workId: string): AgentWorkRecord {
    const now = Date.now();
    const testPromotionMs = Number(process.env.BOB_TEST_PROMOTION_MS);
    const promotionMs =
      process.env.BOB_TEST_MODE === 'offline' &&
      Number.isFinite(testPromotionMs) &&
      testPromotionMs > 0
        ? testPromotionMs
        : PROMOTION_MS;
    const work = this.store.enterAgent(workId, now, promotionMs);
    if (!work) throw new NotFoundException(`Agent Work ${workId} not found`);
    if (work.background_supported && work.promotion_due_at_ms) {
      const delay = Math.max(0, work.promotion_due_at_ms - now);
      const timer = setTimeout(() => this.promote(work.id), delay);
      this.promotionTimers.set(work.id, timer);
    }
    if (work.background_supported && work.profile_deadline_at_ms > now) {
      const timer = setTimeout(
        () => void this.timeout(work.id),
        work.profile_deadline_at_ms - now,
      );
      this.deadlineTimers.set(work.id, timer);
    }
    return work;
  }

  prepare(
    workId: string,
    prompt: string,
    continuation: { harness: AgentHarness; sessionId: string } | null,
  ): PreparedAgentWork {
    const work = this.store.get(workId);
    if (!work) throw new NotFoundException(`Agent Work ${workId} not found`);
    const callbacks = this.store.claimCallbacks(workId, CALLBACK_BATCH_LIMIT);
    const sections: string[] = [];
    if (work.read_only_reason) {
      sections.push(
        `This Agent Work run is read-only. ${work.read_only_reason} Do not attempt to modify files.`,
      );
    }
    if (callbacks.length > 0) sections.push(this.callbackContext(callbacks));
    sections.push(prompt);
    return { work, prompt: sections.join('\n\n'), continuation };
  }

  setSummary(workId: string, summary: string): AgentWorkRecord {
    const work = this.store.setSummary(workId, summary);
    if (!work) throw new NotFoundException(`Agent Work ${workId} not found`);
    return work;
  }

  attachRun(workId: string, run: ManagedAgentRun): AgentWorkRecord {
    this.runs.set(workId, run);
    const work = this.store.attachProcess(
      workId,
      run.processIdentity,
      run.runId,
      run.continuationBranch,
    );
    if (!work) throw new NotFoundException(`Agent Work ${workId} not found`);
    return work;
  }

  markOrphaned(workId: string, reason: string): AgentWorkProjection {
    this.clearTimers(workId);
    const work = this.store.markOrphaned(workId, reason);
    if (!work) throw new NotFoundException(`Agent Work ${workId} not found`);
    const projection = this.store.project(work);
    this.events$.next({
      kind: 'agent_work',
      sessionId: work.session_id,
      harness: work.harness,
      agentWork: projection,
      action: 'orphaned',
      speechSuppressed: true,
      error: reason,
    });
    return projection;
  }

  claimCompletion(workId: string): AgentWorkRecord | null {
    this.clearTimers(workId);
    const work = this.store.claimCompletion(workId);
    if (!work || isTerminalAgentWorkState(work.state)) return null;
    return work;
  }


  finishSuccess(
    workId: string,
    result: AgentTurnResult,
    audioFilename: string | null = null,
    publishTerminal = true,
  ): TerminalResult {
    const claimed = this.store.get(workId);
    if (!claimed) throw new NotFoundException(`Agent Work ${workId} not found`);
    if (isTerminalAgentWorkState(claimed.state)) {
      return {
        work: claimed,
        message: this.store.messageForWork(claimed),
        wasBackground: claimed.promoted_at !== null,
        committed: false,
      };
    }
    if (claimed.state !== 'settling' && claimed.state !== 'background') {
      throw new ConflictException(
        `Agent Work ${workId} cannot succeed from state ${claimed.state}.`,
      );
    }

    const terminal = this.db.transaction(() => {
      const work = this.store.get(workId)!;
      const wasBackground = work.promoted_at !== null;
      const message = this.sessions.addMessage(
        work.session_id,
        'assistant',
        result.displayText,
        result.usage,
      );
      let canonicalAdvanced = false;
      const continuation = result.continuation;
      const recoveryPending =
        !wasBackground &&
        (
          this.db
            .prepare(
              `SELECT agent_recovery_pending AS pending
               FROM sessions WHERE id = ?`,
            )
            .get(work.session_id) as { pending: number } | undefined
        )?.pending === 1;
      if (!wasBackground && continuation) {
        const update = this.db
          .prepare(
            `UPDATE sessions
             SET canonical_revision = canonical_revision + 1,
                 agent_harness = ?,
                 agent_session_id = COALESCE(?, agent_session_id),
                 agent_recovery_pending = 0,
                 claude_session_id = CASE
                   WHEN ? = 'claude' THEN COALESCE(?, claude_session_id)
                   ELSE claude_session_id
                 END,
                 updated_at = datetime('now')
             WHERE id = ? AND canonical_revision = ?`,
          )
          .run(
            continuation.harness,
            continuation.sessionId ?? null,
            continuation.harness,
            continuation.sessionId ?? null,
            work.session_id,
            work.base_revision,
          );
        canonicalAdvanced = update.changes === 1;
      } else if (!wasBackground && recoveryPending) {
        this.db
          .prepare(
            `UPDATE sessions
             SET canonical_revision = canonical_revision + 1,
                 agent_session_id = NULL,
                 agent_recovery_pending = 0,
                 updated_at = datetime('now')
             WHERE id = ? AND canonical_revision = ?
               AND agent_recovery_pending = 1`,
          )
          .run(work.session_id, work.base_revision);
      }

      const callbackRequired = wasBackground || !canonicalAdvanced;
      const sequence = this.store.nextTerminalSequence();
      this.db
        .prepare(
          `UPDATE agent_work
           SET state = 'succeeded', stage = ?, completed_at = datetime('now'),
               error = NULL, terminal_sequence = ?, message_id = ?,
               audio_filename = ?, speech_suppressed = ?,
               run_pid = NULL, run_pgid = NULL, process_birth_marker = NULL,
               updated_at = datetime('now')
           WHERE id = ? AND state = 'settling'`,
        )
        .run(
          publishTerminal ? null : 'piper',
          sequence,
          message.id,
          audioFilename,
          callbackRequired ? 1 : 0,
          work.id,
        );
      this.db
        .prepare(
          `UPDATE turns
           SET state = 'completed', stage = NULL, error = NULL,
               updated_at = datetime('now')
           WHERE id = ? AND state = 'processing'`,
        )
        .run(work.turn_id);

      if (canonicalAdvanced) {
        this.db
          .prepare(
            `UPDATE background_callbacks
             SET delivery_state = 'acknowledged', acknowledged_at = datetime('now')
             WHERE claim_turn_id = ? AND delivery_state = 'claimed'`,
          )
          .run(work.turn_id);
      } else {
        this.store.releaseClaimedCallbacks(work.turn_id);
      }
      if (callbackRequired) {
        this.insertCallback(work, sequence, 'succeeded', result.displayText, message.id);
      }
      return {
        work: this.store.get(work.id)!,
        message,
        wasBackground: callbackRequired,
        committed: true,
      };
    })();

    this.runs.delete(workId);
    if (terminal.wasBackground && publishTerminal) {
      this.events$.next({
        kind: 'agent_work',
        sessionId: terminal.work.session_id,
        harness: terminal.work.harness,
        agentWork: this.store.project(terminal.work),
        action: 'terminal',
        assistantMessage: terminal.message ?? undefined,
        audioFilename,
        speechSuppressed: true,
      });
    }
    return terminal;
  }

  publishSuccess(
    workId: string,
    audioFilename: string | null,
    publishTerminal: boolean,
  ): AgentWorkRecord {
    this.db
      .prepare(
        `UPDATE agent_work
         SET audio_filename = ?, stage = NULL, updated_at = datetime('now')
         WHERE id = ? AND state = 'succeeded'`,
      )
      .run(audioFilename, workId);
    const work = this.store.get(workId);
    if (!work) throw new NotFoundException(`Agent Work ${workId} not found`);
    if (publishTerminal) {
      this.events$.next({
        kind: 'agent_work',
        sessionId: work.session_id,
        harness: work.harness,
        agentWork: this.store.project(work),
        action: 'terminal',
        assistantMessage: this.store.messageForWork(work) ?? undefined,
        audioFilename,
        speechSuppressed: true,
      });
    }
    return work;
  }

  async finishFailure(
    workId: string,
    outcome: 'failed' | 'timed_out' | 'cancelled' | 'interrupted',
    note: string,
    error: string,
  ): Promise<TerminalResult> {
    this.clearTimers(workId);
    const existing = this.store.get(workId);
    if (!existing) throw new NotFoundException(`Agent Work ${workId} not found`);
    if (isTerminalAgentWorkState(existing.state)) {
      return {
        work: existing,
        message: this.store.messageForWork(existing),
        wasBackground: existing.promoted_at !== null,
        committed: false,
      };
    }

    const terminal = this.db.transaction(() => {
      const work = this.store.get(workId)!;
      if (isTerminalAgentWorkState(work.state)) {
        return {
          work,
          message: this.store.messageForWork(work),
          wasBackground: work.promoted_at !== null,
          committed: false,
        };
      }
      const wasBackground = work.promoted_at !== null;
      const message = this.sessions.addMessage(
        work.session_id,
        'assistant',
        note,
        null,
        true,
      );
      const sequence = this.store.nextTerminalSequence();
      const update = this.db
        .prepare(
          `UPDATE agent_work
           SET state = ?, stage = NULL, completed_at = datetime('now'),
               error = ?, terminal_sequence = ?, message_id = ?,
               speech_suppressed = 1,
               run_pid = NULL, run_pgid = NULL, process_birth_marker = NULL,
               updated_at = datetime('now')
           WHERE id = ? AND state IN ('foreground', 'settling', 'background', 'orphaned')`,
        )
        .run(outcome, error, sequence, message.id, work.id);
      if (update.changes !== 1) {
        return {
          work: this.store.get(work.id)!,
          message: null,
          wasBackground,
          committed: false,
        };
      }
      this.db
        .prepare(
          `UPDATE turns
           SET state = 'failed', stage = NULL, error = ?,
               updated_at = datetime('now')
           WHERE id = ? AND state = 'processing'`,
        )
        .run(error, work.turn_id);
      if (
        outcome === 'interrupted' &&
        work.harness === 'pi' &&
        work.promoted_at === null
      ) {
        this.db
          .prepare(
            `UPDATE sessions
             SET agent_recovery_pending = 1, updated_at = datetime('now')
             WHERE id = ? AND canonical_revision = ?`,
          )
          .run(work.session_id, work.base_revision);
      }
      this.store.releaseClaimedCallbacks(work.turn_id);
      if (wasBackground) {
        this.insertCallback(work, sequence, outcome, note, message.id);
      }
      return {
        work: this.store.get(work.id)!,
        message,
        wasBackground,
        committed: true,
      };
    })();

    this.runs.delete(workId);
    if (terminal.committed) {
      this.events$.next({
        kind: 'agent_work',
        sessionId: terminal.work.session_id,
        harness: terminal.work.harness,
        agentWork: this.store.project(terminal.work),
        action: 'terminal',
        assistantMessage: terminal.message ?? undefined,
        speechSuppressed: true,
        error,
      });
    }
    return terminal;
  }

  async cancel(workId: string): Promise<AgentWorkProjection> {
    const work = this.store.get(workId);
    if (!work) throw new NotFoundException(`Agent Work ${workId} not found`);
    if (isTerminalAgentWorkState(work.state)) return this.store.project(work);
    if (work.state !== 'background' && work.state !== 'orphaned') {
      throw new ConflictException('Only background Agent Work can be cancelled.');
    }
    try {
      await this.terminateOwnedProcess(work, work.state === 'orphaned');
    } catch (error) {
      this.markOrphaned(
        work.id,
        `Cancellation could not verify process termination: ${String(error)}`,
      );
      throw new ConflictException(
        'Bob could not verify that the managed process group stopped; ownership remains held.',
      );
    }
    const terminal = await this.finishFailure(
      work.id,
      'cancelled',
      'This background Agent Work run was cancelled.',
      'Cancelled by the user.',
    );
    return this.store.project(terminal.work);
  }

  stream(): Observable<AgentWorkEvent> {
    return this.events$.asObservable();
  }

  private promote(workId: string): void {
    this.promotionTimers.delete(workId);
    const work = this.store.promote(workId);
    if (!work) return;
    this.store.releaseClaimedCallbacks(work.turn_id);
    this.events$.next({
      kind: 'agent_work',
      sessionId: work.session_id,
      harness: work.harness,
      agentWork: this.store.project(work),
      action: 'promoted',
    });
  }

  private async timeout(workId: string): Promise<void> {
    this.deadlineTimers.delete(workId);
    const work = this.store.get(workId);
    if (!work || isTerminalAgentWorkState(work.state)) return;
    try {
      await this.terminateOwnedProcess(work, false);
      await this.finishFailure(
        work.id,
        'timed_out',
        `This Agent Work run timed out after ${Math.round(work.profile_timeout_ms / 60_000)} minutes without producing a response.`,
        'Agent Work reached its profile deadline.',
      );
    } catch (error) {
      this.markOrphaned(
        work.id,
        `Timeout could not verify process termination: ${String(error)}`,
      );
    }
  }

  private async terminateOwnedProcess(
    work: AgentWorkRecord,
    verifyBirthMarker: boolean,
  ): Promise<void> {
    const run = this.runs.get(work.id);
    if (run?.terminate) {
      await run.terminate();
      return;
    }
    const identity = this.identityFor(work);
    if (identity) {
      await terminateProcessGroup(identity, verifyBirthMarker);
      return;
    }
    if (
      work.stage !== 'whisper' &&
      process.env.BOB_TEST_MODE !== 'offline'
    ) {
      throw new Error('Managed process identity is unavailable.');
    }
  }

  private identityFor(work: AgentWorkRecord): ManagedProcessIdentity | null {
    if (
      work.run_pid === null ||
      work.run_pgid === null ||
      work.process_birth_marker === null
    ) {
      return null;
    }
    return {
      pid: work.run_pid,
      pgid: work.run_pgid,
      birthMarker: work.process_birth_marker,
    };
  }

  private callbackContext(callbacks: BackgroundCallbackRecord[]): string {
    const entries = callbacks.map(
      (callback) =>
        `<background-callback id="${callback.id}" outcome="${callback.outcome}" terminal-sequence="${callback.terminal_sequence}">\n${callback.content}\n</background-callback>`,
    );
    return [
      'The following durable Background Callbacks completed after earlier Agent Work was promoted. Treat them as prior Conversation context and continue from them without claiming you produced them in this Turn.',
      '<background-callbacks>',
      ...entries,
      '</background-callbacks>',
    ].join('\n');
  }

  private insertCallback(
    work: AgentWorkRecord,
    sequence: number,
    outcome: Exclude<
      AgentWorkState,
      'foreground' | 'settling' | 'background' | 'orphaned'
    >,
    content: string,
    messageId: number,
  ): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO background_callbacks (
           id, agent_work_id, session_id, terminal_sequence,
           outcome, content, message_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `agent-work:${work.id}`,
        work.id,
        work.session_id,
        sequence,
        outcome,
        content,
        messageId,
      );
  }

  private clearTimers(workId: string): void {
    clearTimeout(this.promotionTimers.get(workId));
    this.promotionTimers.delete(workId);
    clearTimeout(this.deadlineTimers.get(workId));
    this.deadlineTimers.delete(workId);
  }
}
