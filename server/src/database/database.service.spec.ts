import Database from 'better-sqlite3';
import { existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import { DatabaseService } from './database.service';

describe('DatabaseService migrations', () => {
  const previousDatabasePath = process.env.DATABASE_PATH;
  let path: string;

  afterEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(path + suffix)) unlinkSync(path + suffix);
    }
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
  });

  it('rebuilds legacy turns before creating Agent Work foreign keys', () => {
    path = join(tmpdir(), `bob-legacy-${randomUUID()}.db`);
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        claude_session_id TEXT,
        title TEXT NOT NULL,
        profile TEXT NOT NULL DEFAULT 'sample',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE turns (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        state TEXT NOT NULL,
        stage TEXT,
        error TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO sessions (id, title) VALUES ('session-1', 'Legacy');
      INSERT INTO turns (id, session_id, state, stage)
      VALUES ('turn-1', 'session-1', 'processing', 'agent');
    `);
    legacy.close();

    process.env.DATABASE_PATH = path;
    const service = new DatabaseService();
    service.onModuleInit();
    const db = service.getDatabase();
    const turn = db.prepare(`SELECT harness, state FROM turns WHERE id = ?`).get(
      'turn-1',
    );
    const agentWorkTable = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get('agent_work');

    expect(turn).toEqual({ harness: 'pi', state: 'processing' });
    expect(agentWorkTable).toEqual({ name: 'agent_work' });
    expect(
      db.prepare(`SELECT count(*) AS count FROM agent_work`).get(),
    ).toEqual({ count: 0 });
    db.close();
    const reopened = new DatabaseService();
    reopened.onModuleInit();
    expect(
      reopened
        .getDatabase()
        .prepare(`SELECT harness, state FROM turns WHERE id = ?`)
        .get('turn-1'),
    ).toEqual({ harness: 'pi', state: 'processing' });
    reopened.getDatabase().close();
  });
});
