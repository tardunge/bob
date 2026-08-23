import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { isAbsolute, relative } from 'path';
import type { AgentHarness, ManagedProcessIdentity } from '../agent/agent.types';
import type { Message } from '../session/session.dto';
import type {
  AgentWorkAdmission,
  AgentWorkProjection,
  AgentWorkRecord,
  AgentWorkState,
  BackgroundCallbackRecord,
} from './agent-work.types';

const ACTIVE_WORK_STATES = [
  'foreground',
  'settling',
  'background',
  'orphaned',
] as const;

export class AgentWorkAdmissionError extends Error {
  constructor(
    public readonly kind: 'foreground_busy' | 'write_conflict',
    message: string,
  ) {
    super(message);
    this.name = 'AgentWorkAdmissionError';
  }
}

function rootsOverlap(left: string, right: string): boolean {
  const leftToRight = relative(left, right);
  if (leftToRight === '' || (!leftToRight.startsWith('..') && !isAbsolute(leftToRight))) {
    return true;
  }
  const rightToLeft = relative(right, left);
  return rightToLeft === '' || (!rightToLeft.startsWith('..') && !isAbsolute(rightToLeft));
}

export class AgentWorkStore {
  constructor(private readonly db: Database.Database) {}

  get(id: string): AgentWorkRecord | null {
    return (
      (this.db.prepare(`SELECT * FROM agent_work WHERE id = ?`).get(id) as
        | AgentWorkRecord
        | undefined) ?? null
    );
  }

  forTurn(turnId: string): AgentWorkRecord | null {
    return (
      (this.db.prepare(`SELECT * FROM agent_work WHERE turn_id = ?`).get(turnId) as
        | AgentWorkRecord
        | undefined) ?? null
    );
  }

  listForSession(sessionId: string, limit = 20): AgentWorkProjection[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_work
         WHERE session_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(sessionId, limit) as AgentWorkRecord[];
    return rows.map((row) => this.project(row));
  }

  listTerminalAfter(sequence: number, limit = 100): AgentWorkProjection[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_work
         WHERE terminal_sequence > ?
         ORDER BY terminal_sequence ASC, id ASC
         LIMIT ?`,
      )
      .all(sequence, limit) as AgentWorkRecord[];
    return rows.map((row) => this.project(row));
  }

  maxTerminalSequence(): number {
    const row = this.db
      .prepare(`SELECT value FROM terminal_sequence WHERE singleton = 1`)
      .get() as { value: number };
    return row.value;
  }

  active(): AgentWorkRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM agent_work
         WHERE state IN (${ACTIVE_WORK_STATES.map(() => '?').join(', ')})
         ORDER BY created_at ASC, id ASC`,
      )
      .all(...ACTIVE_WORK_STATES) as AgentWorkRecord[];
  }

  hasForeground(sessionId: string): boolean {
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM agent_work
           WHERE session_id = ?
             AND (
               state = 'foreground'
               OR (state = 'settling' AND promoted_at IS NULL)
               OR state = 'orphaned'
               OR (state = 'succeeded' AND stage = 'piper' AND promoted_at IS NULL)
             )
           LIMIT 1`,
        )
        .get(sessionId),
    );
  }

  admit(
    sessionId: string,
    harness: AgentHarness,
    profileTimeoutMs: number,
    requestedWriteRoots: string[],
    backgroundSupported: boolean,
    enforcedWriteRoots: boolean,
  ): AgentWorkAdmission {
    return this.db.transaction(() => {
      if (this.hasForeground(sessionId)) {
        throw new AgentWorkAdmissionError(
          'foreground_busy',
          'A foreground Agent Work run already owns this Conversation.',
        );
      }

      const activeRoots = this.active().flatMap((work) =>
        (JSON.parse(work.write_roots_json) as string[]).map((root) => ({
          work,
          root,
        })),
      );
      const conflict = requestedWriteRoots.some((requested) =>
        activeRoots.some(({ root }) => rootsOverlap(requested, root)),
      );
      let writeRoots = requestedWriteRoots;
      let readOnlyReason: string | null = null;
      if (conflict) {
        if (!enforcedWriteRoots) {
          throw new AgentWorkAdmissionError(
            'write_conflict',
            'An active Agent Work run owns an overlapping write root and this adapter cannot enforce read-only operation.',
          );
        }
        writeRoots = [];
        readOnlyReason =
          'Read-only while another Agent Work run owns an overlapping write root.';
      }

      const session = this.db
        .prepare(`SELECT canonical_revision FROM sessions WHERE id = ?`)
        .get(sessionId) as { canonical_revision: number } | undefined;
      if (!session) throw new Error(`Session ${sessionId} not found`);

      const turnId = randomUUID();
      const workId = randomUUID();
      this.db
        .prepare(
          `INSERT INTO turns (id, session_id, harness, state, stage)
           VALUES (?, ?, ?, 'processing', 'whisper')`,
        )
        .run(turnId, sessionId, harness);
      this.db
        .prepare(
          `INSERT INTO agent_work (
             id, turn_id, session_id, harness, state, stage,
             background_supported, base_revision, profile_timeout_ms,
             write_roots_json, read_only_reason
           ) VALUES (?, ?, ?, ?, 'foreground', 'whisper', ?, ?, ?, ?, ?)`,
        )
        .run(
          workId,
          turnId,
          sessionId,
          harness,
          backgroundSupported ? 1 : 0,
          session.canonical_revision,
          profileTimeoutMs,
          JSON.stringify(writeRoots),
          readOnlyReason,
        );
      return { turnId, work: this.get(workId)! };
    })();
  }

  enterAgent(id: string, nowMs: number, promotionMs: number): AgentWorkRecord | null {
    const work = this.get(id);
    if (!work || work.state !== 'foreground') return work;
    const promotionDue = work.background_supported ? nowMs + promotionMs : null;
    this.db
      .prepare(
        `UPDATE agent_work
         SET stage = 'agent', profile_deadline_at_ms = ?, promotion_due_at_ms = ?,
             updated_at = datetime('now')
         WHERE id = ? AND state = 'foreground'`,
      )
      .run(nowMs + work.profile_timeout_ms, promotionDue, id);
    this.db
      .prepare(`UPDATE turns SET stage = 'agent', updated_at = datetime('now') WHERE id = ?`)
      .run(work.turn_id);
    return this.get(id);
  }

  promote(id: string): AgentWorkRecord | null {
    const result = this.db
      .prepare(
        `UPDATE agent_work
         SET state = 'background', promoted_at = datetime('now'),
             updated_at = datetime('now')
         WHERE id = ? AND state = 'foreground' AND stage = 'agent'`,
      )
      .run(id);
    return result.changes === 1 ? this.get(id) : null;
  }

  claimCompletion(id: string): AgentWorkRecord | null {
    const work = this.get(id);
    if (!work) return null;
    if (work.state === 'foreground' || work.state === 'background') {
      const updated = this.db
        .prepare(
          `UPDATE agent_work
           SET state = 'settling', updated_at = datetime('now')
           WHERE id = ? AND state = ?`,
        )
        .run(id, work.state);
      if (updated.changes === 1) return this.get(id);
      return this.get(id);
    }
    return work;
  }


  setSummary(id: string, summary: string): AgentWorkRecord | null {
    this.db
      .prepare(
        `UPDATE agent_work SET summary = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(summary, id);
    return this.get(id);
  }

  attachProcess(
    id: string,
    identity: ManagedProcessIdentity | null,
    runId: string | null,
    continuationBranch: string | null,
  ): AgentWorkRecord | null {
    this.db
      .prepare(
        `UPDATE agent_work
         SET run_pid = ?, run_pgid = ?, process_birth_marker = ?,
             adapter_run_id = ?, continuation_branch = ?,
             updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        identity?.pid ?? null,
        identity?.pgid ?? null,
        identity?.birthMarker ?? null,
        runId,
        continuationBranch,
        id,
      );
    return this.get(id);
  }

  claimCallbacks(workId: string, limit = 20): BackgroundCallbackRecord[] {
    return this.db.transaction(() => {
      const work = this.get(workId);
      if (!work) return [];
      const callbacks = this.db
        .prepare(
          `SELECT * FROM background_callbacks
           WHERE session_id = ? AND delivery_state = 'pending'
           ORDER BY terminal_sequence ASC, id ASC
           LIMIT ?`,
        )
        .all(work.session_id, limit) as BackgroundCallbackRecord[];
      const claim = this.db.prepare(
        `UPDATE background_callbacks
         SET delivery_state = 'claimed', claim_turn_id = ?
         WHERE id = ? AND delivery_state = 'pending'`,
      );
      return callbacks.filter((callback) => claim.run(work.turn_id, callback.id).changes === 1);
    })();
  }

  callbacksClaimedByTurn(turnId: string): BackgroundCallbackRecord[] {
    return this.db
      .prepare(
        `SELECT * FROM background_callbacks
         WHERE claim_turn_id = ? AND delivery_state = 'claimed'
         ORDER BY terminal_sequence ASC, id ASC`,
      )
      .all(turnId) as BackgroundCallbackRecord[];
  }

  releaseClaimedCallbacks(turnId: string): void {
    this.db
      .prepare(
        `UPDATE background_callbacks
         SET delivery_state = 'pending', claim_turn_id = NULL
         WHERE claim_turn_id = ? AND delivery_state = 'claimed'`,
      )
      .run(turnId);
  }

  nextTerminalSequence(): number {
    this.db
      .prepare(`UPDATE terminal_sequence SET value = value + 1 WHERE singleton = 1`)
      .run();
    return this.maxTerminalSequence();
  }

  project(work: AgentWorkRecord): AgentWorkProjection {
    return {
      ...work,
      write_roots: JSON.parse(work.write_roots_json) as string[],
      cancellable: work.state === 'background' || work.state === 'orphaned',
    };
  }

  messageForWork(work: AgentWorkRecord): Message | null {
    if (!work.message_id) return null;
    return (
      (this.db.prepare(`SELECT * FROM messages WHERE id = ?`).get(work.message_id) as
        | Message
        | undefined) ?? null
    );
  }

  markOrphaned(id: string, error: string): AgentWorkRecord | null {
    this.db
      .prepare(
        `UPDATE agent_work
         SET state = 'orphaned', error = ?, updated_at = datetime('now')
         WHERE id = ? AND state IN ('foreground', 'settling', 'background')`,
      )
      .run(error, id);
    return this.get(id);
  }
}
