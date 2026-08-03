import { Injectable, OnModuleInit } from '@nestjs/common';
import Database from 'better-sqlite3';
import { join } from 'path';

@Injectable()
export class DatabaseService implements OnModuleInit {
  private db: Database.Database;

  onModuleInit() {
    const dbPath = process.env.DATABASE_PATH || join(process.cwd(), 'bob.db');
    console.log(`Initializing SQLite database at: ${dbPath}`);

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        claude_session_id TEXT,
        agent_harness TEXT NOT NULL DEFAULT 'pi',
        agent_session_id TEXT,
        agent_recovery_pending INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL,
        profile TEXT NOT NULL DEFAULT 'sample',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT CHECK(role IN ('user', 'assistant')),
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        -- A failed turn is persisted as an assistant row with is_error=1 so a
        -- later visit can render why no reply appeared. These rows carry no
        -- usage and never reach Claude's resumed session (Bob's message table
        -- is display-only) — they exist purely to explain a gap in the thread.
        is_error INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

      CREATE TABLE IF NOT EXISTS turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        harness TEXT NOT NULL DEFAULT 'pi' CHECK(harness IN ('claude', 'pi')),
        state TEXT NOT NULL CHECK(state IN ('processing', 'completed', 'failed')),
        stage TEXT CHECK(stage IN ('whisper', 'agent', 'piper')),
        error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_turns_session_id ON turns(session_id);
      CREATE INDEX IF NOT EXISTS idx_turns_processing ON turns(session_id, state);
    `);

    const turnsTable = this.db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'turns'`,
      )
      .get() as { sql?: string } | undefined;
    if (
      turnsTable?.sql?.includes("'claude'") &&
      !turnsTable.sql.includes("'agent'")
    ) {
      this.db.transaction(() => {
        this.db.exec(`
          ALTER TABLE turns RENAME TO turns_legacy;
          CREATE TABLE turns (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
            harness TEXT NOT NULL DEFAULT 'pi' CHECK(harness IN ('claude', 'pi')),
            state TEXT NOT NULL CHECK(state IN ('processing', 'completed', 'failed')),
            stage TEXT CHECK(stage IN ('whisper', 'agent', 'piper')),
            error TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
          );
          INSERT INTO turns (
            id, session_id, harness, state, stage, error, created_at, updated_at
          )
          SELECT
            id, session_id, harness, state,
            CASE stage WHEN 'claude' THEN 'agent' ELSE stage END,
            error, created_at, updated_at
          FROM turns_legacy;
          DROP TABLE turns_legacy;
          CREATE INDEX idx_turns_session_id ON turns(session_id);
          CREATE INDEX idx_turns_processing ON turns(session_id, state);
        `);
      })();
    }

    const turnCols = this.db
      .prepare(`PRAGMA table_info(turns)`)
      .all() as Array<{ name: string }>;
    if (!turnCols.some((c) => c.name === 'harness')) {
      this.db.exec(
        `ALTER TABLE turns ADD COLUMN harness TEXT NOT NULL DEFAULT 'pi'`,
      );
    }

    const columns = this.db
      .prepare(`PRAGMA table_info(sessions)`)
      .all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === 'profile')) {
      this.db.exec(
        `ALTER TABLE sessions ADD COLUMN profile TEXT NOT NULL DEFAULT 'sample'`,
      );
    }

    const sessionCols = this.db
      .prepare(`PRAGMA table_info(sessions)`)
      .all() as Array<{ name: string }>;
    const sessionColNames = new Set(sessionCols.map((c) => c.name));
    if (!sessionColNames.has('agent_harness')) {
      this.db.exec(
        `ALTER TABLE sessions ADD COLUMN agent_harness TEXT NOT NULL DEFAULT 'pi'`,
      );
    }
    if (!sessionColNames.has('agent_session_id')) {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN agent_session_id TEXT`);
    }
    if (!sessionColNames.has('agent_recovery_pending')) {
      this.db.exec(
        `ALTER TABLE sessions ADD COLUMN agent_recovery_pending INTEGER NOT NULL DEFAULT 0`,
      );
    }
    // Existing Bob sessions resume through the old Claude-specific column;
    // copy it once into the neutral continuation column during migration.
    this.db.exec(`
      UPDATE sessions
      SET agent_session_id = claude_session_id
      WHERE agent_session_id IS NULL AND claude_session_id IS NOT NULL
    `);

    const msgCols = this.db
      .prepare(`PRAGMA table_info(messages)`)
      .all() as Array<{ name: string }>;
    const msgColNames = new Set(msgCols.map((c) => c.name));
    const usageCols: Array<[string, string]> = [
      ['usage_input_tokens', 'INTEGER'],
      ['usage_output_tokens', 'INTEGER'],
      ['usage_cache_read_tokens', 'INTEGER'],
      ['usage_cache_creation_tokens', 'INTEGER'],
      ['usage_cost_usd', 'REAL'],
      ['usage_context_window', 'INTEGER'],
      ['usage_context_tokens', 'INTEGER'],
    ];
    for (const [name, type] of usageCols) {
      if (!msgColNames.has(name)) {
        this.db.exec(`ALTER TABLE messages ADD COLUMN ${name} ${type}`);
      }
    }
    if (!msgColNames.has('is_error')) {
      this.db.exec(
        `ALTER TABLE messages ADD COLUMN is_error INTEGER NOT NULL DEFAULT 0`,
      );
    }

    console.log('Database schema initialized');
  }

  getDatabase(): Database.Database {
    return this.db;
  }
}
