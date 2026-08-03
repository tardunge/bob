import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { DatabaseService } from '../database/database.service';
import { SessionService } from '../session/session.service';
import { MemoryStore } from './memory-store';
import { DEFAULT_PROFILE } from '../profiles';

describe('MemoryStore', () => {
  let database: DatabaseService;
  let sessions: SessionService;
  let store: MemoryStore;
  let dbPath: string;
  const previous = process.env.DATABASE_PATH;

  beforeEach(() => {
    dbPath = join(tmpdir(), `bob-memory-${randomUUID()}.db`);
    process.env.DATABASE_PATH = dbPath;
    database = new DatabaseService();
    database.onModuleInit();
    sessions = new SessionService(database);
    store = new MemoryStore(database.getDatabase());
  });

  afterEach(() => {
    database.getDatabase().close();
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
    }
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
  });

  it('lists, searches, and retrieves conversations through one store', () => {
    const session = sessions.createSession({ title: 'architecture chat' });
    sessions.addMessage(session.id, 'user', 'How should Bob support Pi?');
    sessions.addMessage(session.id, 'assistant', 'Use a harness-neutral runtime.');

    expect(store.listSessions(DEFAULT_PROFILE)).toMatchObject([
      { id: session.id, title: 'architecture chat', message_count: 2 },
    ]);
    expect(
      store.searchConversations(DEFAULT_PROFILE, 'harness-neutral')[0],
    ).toMatchObject({
      session_id: session.id,
      role: 'assistant',
    });
    expect(
      store.getConversation(DEFAULT_PROFILE, session.id)?.messages,
    ).toHaveLength(2);
  });

  it('does not expose conversations from another profile', () => {
    const own = sessions.createSession({ title: 'own profile' });
    const other = sessions.createSession({ title: 'other profile' });
    sessions.addMessage(own.id, 'user', 'visible memory');
    sessions.addMessage(other.id, 'user', 'private other memory');
    database
      .getDatabase()
      .prepare(`UPDATE sessions SET profile = 'other' WHERE id = ?`)
      .run(other.id);

    expect(
      store.listSessions(DEFAULT_PROFILE).map((session) => session.id),
    ).toEqual([
      own.id,
    ]);
    expect(
      store.searchConversations(DEFAULT_PROFILE, 'memory'),
    ).toHaveLength(1);
    expect(store.getConversation(DEFAULT_PROFILE, other.id)).toBeNull();
  });

  it('honors message cascade when a session is deleted', () => {
    const session = sessions.createSession({ title: 'temporary' });
    sessions.addMessage(session.id, 'user', 'remove me');
    expect(sessions.deleteSession(session.id)).toBe(true);
    expect(store.getConversation(DEFAULT_PROFILE, session.id)).toBeNull();
    expect(
      database.getDatabase().prepare('SELECT COUNT(*) AS count FROM messages WHERE session_id = ?').get(session.id),
    ).toEqual({ count: 0 });
  });
});
