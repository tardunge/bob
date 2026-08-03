import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { DatabaseService } from '../database/database.service';
import { SessionService } from '../session/session.service';
import { TurnStore } from './turn-store';

describe('TurnStore', () => {
  let database: DatabaseService;
  let sessions: SessionService;
  let turns: TurnStore;
  let dbPath: string;
  const previous = process.env.DATABASE_PATH;

  beforeEach(() => {
    dbPath = join(tmpdir(), `bob-turn-${randomUUID()}.db`);
    process.env.DATABASE_PATH = dbPath;
    database = new DatabaseService();
    database.onModuleInit();
    sessions = new SessionService(database);
    turns = new TurnStore(database.getDatabase());
  });

  afterEach(() => {
    database.getDatabase().close();
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
    }
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
  });

  it('persists lifecycle and stage transitions', () => {
    const session = sessions.createSession({ title: 'turn' });
    const turn = turns.create(session.id, 'claude');
    expect(turn).toMatchObject({ state: 'processing', stage: 'whisper' });
    expect(turns.setStage(turn.id, 'agent')).toMatchObject({ stage: 'agent' });
    expect(turns.complete(turn.id)).toMatchObject({ state: 'completed', stage: null });
  });

  it('reconciles processing turns after a restart', () => {
    const session = sessions.createSession({ title: 'interrupted' });
    turns.create(session.id, 'pi');
    expect(turns.reconcileProcessing('server restarted')).toBe(1);
    expect(turns.latestForSession(session.id)).toMatchObject({
      state: 'failed',
      error: 'server restarted',
    });
    expect(sessions.isAgentRecoveryPending(session.id)).toBe(true);

    const claudeSession = sessions.createSession({
      title: 'claude turn',
      agent_harness: 'claude',
    });
    turns.create(claudeSession.id, 'claude');
    turns.reconcileProcessing('server restarted again');
    expect(sessions.isAgentRecoveryPending(claudeSession.id)).toBe(false);
  });
});
