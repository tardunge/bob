import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { AgentHarness } from '../agent/agent.types';

export type TurnState = 'processing' | 'completed' | 'failed';
export type TurnStage = 'whisper' | 'agent' | 'piper';

export interface TurnRecord {
  id: string;
  session_id: string;
  harness: AgentHarness;
  state: TurnState;
  stage: TurnStage | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export class TurnStore {
  constructor(private readonly db: Database.Database) {}

  create(sessionId: string, harness: AgentHarness): TurnRecord {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO turns (id, session_id, harness, state, stage) VALUES (?, ?, ?, 'processing', 'whisper')`,
      )
      .run(id, sessionId, harness);
    return this.get(id)!;
  }

  get(id: string): TurnRecord | null {
    return (
      (this.db.prepare('SELECT * FROM turns WHERE id = ?').get(id) as TurnRecord) ||
      null
    );
  }

  latestForSession(sessionId: string): TurnRecord | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM turns WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
        )
        .get(sessionId) as TurnRecord) || null
    );
  }

  processingForSession(sessionId: string): TurnRecord | null {
    return (
      (this.db
        .prepare(
          `SELECT * FROM turns WHERE session_id = ? AND state = 'processing' ORDER BY created_at DESC, id DESC LIMIT 1`,
        )
        .get(sessionId) as TurnRecord) || null
    );
  }

  setStage(id: string, stage: TurnStage): TurnRecord | null {
    this.db
      .prepare(
        `UPDATE turns SET stage = ?, error = NULL, updated_at = datetime('now') WHERE id = ? AND state = 'processing'`,
      )
      .run(stage, id);
    return this.get(id);
  }

  complete(id: string): TurnRecord | null {
    this.db
      .prepare(
        `UPDATE turns SET state = 'completed', stage = NULL, error = NULL, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(id);
    return this.get(id);
  }

  fail(id: string, error: string): TurnRecord | null {
    this.db
      .prepare(
        `UPDATE turns SET state = 'failed', stage = NULL, error = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(error, id);
    return this.get(id);
  }

  reconcileProcessing(reason: string, legacyOnly = false): number {
    return this.db.transaction(() => {
      const legacyFilter = legacyOnly
        ? ` AND NOT EXISTS (
              SELECT 1 FROM agent_work WHERE agent_work.turn_id = turns.id
            )`
        : '';
      this.db.exec(`
        UPDATE sessions
        SET agent_recovery_pending = 1
        WHERE agent_harness = 'pi'
          AND id IN (
            SELECT DISTINCT session_id
            FROM turns
            WHERE state = 'processing' AND harness = 'pi'${legacyFilter}
          )
      `);
      const result = this.db
        .prepare(
          `UPDATE turns
           SET state = 'failed', stage = NULL, error = ?, updated_at = datetime('now')
           WHERE state = 'processing'${legacyFilter}`,
        )
        .run(reason);
      return result.changes;
    })();
  }
}
