import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  Session,
  Message,
  SessionWithMessages,
  SessionUsage,
  CreateSessionDto,
  UpdateSessionDto,
} from './session.dto';
import {
  VALID_AGENT_HARNESSES,
  type AgentHarness,
  type AgentUsage,
} from '../agent/agent.types';
import {
  DEFAULT_PROFILE,
  PROFILE_KEYS,
  getProfileConfig,
  isValidProfile,
} from '../profiles';
import { randomUUID } from 'crypto';
import { TurnStore } from '../turn/turn-store';
import { AgentWorkStore } from '../agent-work/agent-work.store';

function isAgentHarness(value: unknown): value is AgentHarness {
  return (
    typeof value === 'string' &&
    VALID_AGENT_HARNESSES.has(value as AgentHarness)
  );
}

@Injectable()
export class SessionService {
  constructor(private readonly databaseService: DatabaseService) {}

  private get db() {
    return this.databaseService.getDatabase();
  }

  createSession(dto: CreateSessionDto = {}): Session {
    const id = randomUUID();
    const title = dto.title || `Session ${new Date().toLocaleString()}`;
    const profile = dto.profile ?? DEFAULT_PROFILE;

    if (!isValidProfile(profile)) {
      throw new BadRequestException(
        `Unknown profile '${String(profile)}'. Valid profiles: ${PROFILE_KEYS.join(', ')}`,
      );
    }
    const agentHarness =
      dto.agent_harness ?? getProfileConfig(profile).defaultHarness;

    if (!isAgentHarness(agentHarness)) {
      throw new BadRequestException(
        `Unknown agent harness '${String(agentHarness)}'. Valid harnesses: claude, omp, pi`,
      );
    }

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, title, profile, agent_harness)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, title, profile, agentHarness);

    return this.getSession(id)!;
  }

  getAllSessions(): Session[] {
    const stmt = this.db.prepare(`
      SELECT id, claude_session_id, agent_harness,
             COALESCE(agent_session_id, claude_session_id) AS agent_session_id,
             title, profile, created_at, updated_at
      FROM sessions
      ORDER BY updated_at DESC
    `);
    return stmt.all() as Session[];
  }

  getSession(id: string): Session | null {
    const stmt = this.db.prepare(`
      SELECT id, claude_session_id, agent_harness,
             COALESCE(agent_session_id, claude_session_id) AS agent_session_id,
             title, profile, created_at, updated_at
      FROM sessions
      WHERE id = ?
    `);
    return (stmt.get(id) as Session) || null;
  }

  getSessionWithMessages(id: string): SessionWithMessages | null {
    const session = this.getSession(id);
    if (!session) return null;

    const messagesStmt = this.db.prepare(`
      SELECT id, session_id, role, content, created_at, is_error
      FROM messages
      WHERE session_id = ?
      ORDER BY created_at ASC
    `);
    const messages = messagesStmt.all(id) as Message[];
    const active_turn = new TurnStore(this.db).latestForSession(id);
    const agent_work = new AgentWorkStore(this.db).listForSession(id);

    return { ...session, messages, active_turn, agent_work };
  }

  updateSession(id: string, dto: UpdateSessionDto): Session | null {
    const updates: string[] = [];
    const values: (string | null)[] = [];
    const canonicalMutation =
      dto.claude_session_id !== undefined ||
      dto.agent_session_id !== undefined ||
      dto.agent_harness !== undefined;

    if (dto.title !== undefined) {
      updates.push('title = ?');
      values.push(dto.title);
    }
    if (dto.claude_session_id !== undefined) {
      updates.push('claude_session_id = ?', 'agent_session_id = ?', 'agent_harness = ?');
      values.push(dto.claude_session_id, dto.claude_session_id, 'claude');
    }
    if (dto.agent_session_id !== undefined) {
      updates.push('agent_session_id = ?');
      values.push(dto.agent_session_id);
    }
    if (dto.agent_harness !== undefined) {
      if (!isAgentHarness(dto.agent_harness)) {
        throw new BadRequestException(
          `Unknown agent harness '${String(dto.agent_harness)}'. Valid harnesses: claude, pi`,
        );
      }
      updates.push('agent_harness = ?');
      values.push(dto.agent_harness);
    }

    if (updates.length === 0) {
      return this.getSession(id);
    }
    if (canonicalMutation) {
      updates.push('canonical_revision = canonical_revision + 1');
    }

    updates.push("updated_at = datetime('now')");
    values.push(id);

    const stmt = this.db.prepare(`
      UPDATE sessions
      SET ${updates.join(', ')}
      WHERE id = ?
    `);
    stmt.run(...values);

    return this.getSession(id);
  }

  isAgentRecoveryPending(id: string): boolean {
    const row = this.db
      .prepare(
        `SELECT agent_recovery_pending AS pending FROM sessions WHERE id = ?`,
      )
      .get(id) as { pending: number } | undefined;
    return row?.pending === 1;
  }

  clearAgentRecovery(id: string): void {
    this.db
      .prepare(
        `UPDATE sessions
         SET agent_recovery_pending = 0, agent_session_id = NULL,
             canonical_revision = canonical_revision + 1
         WHERE id = ?`,
      )
      .run(id);
  }

  updateAgentContinuation(
    id: string,
    harness: AgentHarness,
    sessionId: string | null,
  ): Session | null {
    if (!isAgentHarness(harness)) {
      throw new BadRequestException(`Unknown agent harness '${String(harness)}'.`);
    }
    const stmt = this.db.prepare(`
      UPDATE sessions
      SET agent_harness = ?, agent_session_id = ?,
          agent_recovery_pending = 0,
          claude_session_id = CASE WHEN ? = 'claude' THEN ? ELSE claude_session_id END,
          canonical_revision = canonical_revision + 1,
          updated_at = datetime('now')
      WHERE id = ?
    `);
    stmt.run(harness, sessionId, harness, sessionId, id);
    return this.getSession(id);
  }

  deleteSession(id: string): boolean {
    const active = this.db
      .prepare(
        `SELECT 1 FROM agent_work
         WHERE session_id = ?
           AND state IN ('foreground', 'settling', 'background', 'orphaned')
         LIMIT 1`,
      )
      .get(id);
    if (active) {
      throw new ConflictException(
        'Cancel active Agent Work before deleting this Conversation.',
      );
    }
    const stmt = this.db.prepare('DELETE FROM sessions WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }

  addMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: string,
    usage?: AgentUsage | null,
    isError = false,
  ): Message {
    const stmt = this.db.prepare(`
      INSERT INTO messages (
        session_id, role, content, is_error,
        usage_input_tokens, usage_output_tokens,
        usage_cache_read_tokens, usage_cache_creation_tokens,
        usage_cost_usd, usage_context_window, usage_context_tokens
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      sessionId,
      role,
      content,
      isError ? 1 : 0,
      usage?.inputTokens ?? null,
      usage?.outputTokens ?? null,
      usage?.cacheReadTokens ?? null,
      usage?.cacheCreationTokens ?? null,
      usage?.costUsd ?? null,
      usage?.contextWindow ?? null,
      usage?.contextTokens ?? null,
    );

    // Update session's updated_at
    this.db
      .prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?")
      .run(sessionId);

    const messageStmt = this.db.prepare('SELECT * FROM messages WHERE id = ?');
    return messageStmt.get(result.lastInsertRowid) as Message;
  }

  getSessionUsage(sessionId: string): SessionUsage {
    const sum = this.db
      .prepare(
        `SELECT
           COALESCE(SUM(usage_input_tokens), 0) AS inputTokens,
           COALESCE(SUM(usage_output_tokens), 0) AS outputTokens,
           COALESCE(SUM(usage_cache_read_tokens), 0) AS cacheReadTokens,
           COALESCE(SUM(usage_cache_creation_tokens), 0) AS cacheCreationTokens,
           COALESCE(SUM(usage_cost_usd), 0) AS costUsd
         FROM messages
         WHERE session_id = ? AND role = 'assistant'`,
      )
      .get(sessionId) as {
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      costUsd: number;
    };

    const latest = this.db
      .prepare(
        `SELECT
           usage_input_tokens AS inputTokens,
           usage_cache_read_tokens AS cacheReadTokens,
           usage_cache_creation_tokens AS cacheCreationTokens,
           usage_context_window AS contextWindow,
           usage_context_tokens AS contextTokens
         FROM messages
         WHERE session_id = ? AND role = 'assistant' AND usage_input_tokens IS NOT NULL
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(sessionId) as
      | {
          inputTokens: number;
          cacheReadTokens: number;
          cacheCreationTokens: number;
          contextWindow: number;
          contextTokens?: number | null;
        }
      | undefined;

    return { cumulative: sum, latest: latest ?? null };
  }

  getMessages(sessionId: string): Message[] {
    const stmt = this.db.prepare(`
      SELECT id, session_id, role, content, created_at, is_error
      FROM messages
      WHERE session_id = ?
      ORDER BY created_at ASC
    `);
    return stmt.all(sessionId) as Message[];
  }
  buildRecoveryPrompt(
    sessionId: string,
    currentMessageId: number,
    currentPrompt: string,
    limit = 20,
  ): string {
    const recent = this.db
      .prepare(
        `SELECT id, session_id, role, content, created_at, is_error
         FROM messages
         WHERE session_id = ? AND id < ? AND is_error = 0
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(sessionId, currentMessageId, limit) as Message[];
    recent.reverse();

    let unansweredIndex = -1;
    for (let index = recent.length - 1; index >= 0; index -= 1) {
      if (recent[index].role === 'assistant') break;
      if (recent[index].role === 'user') {
        unansweredIndex = index;
        break;
      }
    }

    const transcript = recent.map((message, index) => {
      const label =
        index === unansweredIndex
          ? 'user — UNANSWERED: agent turn interrupted by server restart'
          : message.role;
      return `[${label}]\n${message.content}`;
    });

    return [
      'A previous Pi continuation was interrupted when Bob restarted.',
      'Start a fresh continuation. Use the persisted conversation below as context; do not claim that you produced any missing reply.',
      '<recent_conversation>',
      ...transcript,
      '</recent_conversation>',
      '<current_request>',
      currentPrompt,
      '</current_request>',
    ].join('\n\n');
  }

}
