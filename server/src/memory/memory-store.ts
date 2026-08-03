import Database from 'better-sqlite3';

export interface MemorySessionRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface MemorySearchRow {
  content: string;
  role: 'user' | 'assistant';
  created_at: string;
  title: string;
  session_id: string;
}

export interface MemoryConversation {
  session: Record<string, unknown>;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
  }>;
}

export class MemoryStore {
  constructor(private readonly db: Database.Database) {}

  listSessions(profile: string, limit = 20): MemorySessionRow[] {
    return this.db
      .prepare(
        `
        SELECT id, title, created_at, updated_at,
               (SELECT COUNT(*) FROM messages WHERE session_id = sessions.id) AS message_count
        FROM sessions
        WHERE profile = ?
        ORDER BY updated_at DESC
        LIMIT ?
      `,
      )
      .all(profile, limit) as MemorySessionRow[];
  }

  searchConversations(
    profile: string,
    query: string,
    limit = 20,
  ): MemorySearchRow[] {
    return this.db
      .prepare(
        `
        SELECT m.content, m.role, m.created_at, s.title, s.id AS session_id
        FROM messages m
        JOIN sessions s ON m.session_id = s.id
        WHERE s.profile = ? AND m.content LIKE ?
        ORDER BY m.created_at DESC
        LIMIT ?
      `,
      )
      .all(profile, `%${query}%`, limit) as MemorySearchRow[];
  }

  getConversation(
    profile: string,
    sessionId: string,
  ): MemoryConversation | null {
    const session = this.db
      .prepare('SELECT * FROM sessions WHERE id = ? AND profile = ?')
      .get(sessionId, profile) as Record<string, unknown> | undefined;
    if (!session) return null;

    const messages = this.db
      .prepare(
        `
        SELECT role, content, created_at
        FROM messages
        WHERE session_id = ?
        ORDER BY created_at ASC
      `,
      )
      .all(sessionId) as MemoryConversation['messages'];

    return { session, messages };
  }
}
