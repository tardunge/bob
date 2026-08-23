import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { existsSync, unlinkSync } from 'fs';
import { DatabaseService } from '../database/database.service';
import { SessionService } from './session.service';
import { DEFAULT_PROFILE } from '../profiles';

// Exercises the session store against a real (temporary) SQLite database using
// the production schema, so the tests assert observable round-trip behavior
// rather than mocking the driver.
describe('SessionService', () => {
  let dbService: DatabaseService;
  let service: SessionService;
  let dbPath: string;
  const prevEnv = process.env.DATABASE_PATH;

  beforeEach(() => {
    dbPath = join(tmpdir(), `bob-test-${randomUUID()}.db`);
    process.env.DATABASE_PATH = dbPath;
    dbService = new DatabaseService();
    dbService.onModuleInit();
    service = new SessionService(dbService);
  });

  afterEach(() => {
    dbService.getDatabase().close();
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
    }
    if (prevEnv === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = prevEnv;
  });

  it('creates and retrieves a session using the configured default profile', () => {
    const s = service.createSession({ title: 'design chat' });
    expect(s.profile).toBe(DEFAULT_PROFILE);
    expect(s.title).toBe('design chat');
    expect(service.getSession(s.id)).toMatchObject({ id: s.id, title: 'design chat' });
  });

  it('rejects an unknown profile', () => {
    expect(() => service.createSession({ profile: 'nope' as never })).toThrow();
  });

  it('appends user/assistant turns and returns them in order', () => {
    const s = service.createSession({ title: 't' });
    service.addMessage(s.id, 'user', 'hi');
    service.addMessage(s.id, 'assistant', 'hello');
    const full = service.getSessionWithMessages(s.id);
    expect(full?.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'hi'],
      ['assistant', 'hello'],
    ]);
  });

  it('aggregates per-turn usage into cumulative totals and the latest turn', () => {
    const s = service.createSession({ title: 't' });
    service.addMessage(s.id, 'assistant', 'a', {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 1,
      cacheCreationTokens: 2,
      costUsd: 0.01,
      contextWindow: 200_000,
    });
    service.addMessage(s.id, 'assistant', 'b', {
      inputTokens: 20,
      outputTokens: 7,
      cacheReadTokens: 3,
      cacheCreationTokens: 4,
      costUsd: 0.02,
      contextWindow: 1_000_000,
    });
    const u = service.getSessionUsage(s.id);
    expect(u.cumulative.inputTokens).toBe(30);
    expect(u.cumulative.outputTokens).toBe(12);
    expect(u.cumulative.costUsd).toBeCloseTo(0.03);
    expect(u.latest?.inputTokens).toBe(20);
    expect(u.latest?.contextWindow).toBe(1_000_000);
  });

  it('returns zeroed usage and null latest for a session with no assistant turns', () => {
    const s = service.createSession({ title: 't' });
    const u = service.getSessionUsage(s.id);
    expect(u.cumulative.inputTokens).toBe(0);
    expect(u.cumulative.costUsd).toBe(0);
    expect(u.latest).toBeNull();
  });

  it('stores a harness-neutral continuation and preserves Claude compatibility', () => {
    const s = service.createSession({ title: 'pi chat', agent_harness: 'pi' });
    expect(s).toMatchObject({
      agent_harness: 'pi',
      agent_session_id: null,
    });

    const updated = service.updateAgentContinuation(s.id, 'pi', '/tmp/pi-session.jsonl');
    expect(updated).toMatchObject({
      agent_harness: 'pi',
      agent_session_id: '/tmp/pi-session.jsonl',
    });
  });

  it('creates an OMP session when selected by a profile or request', () => {
    const session = service.createSession({
      title: 'omp chat',
      agent_harness: 'omp',
    });
    expect(session).toMatchObject({
      agent_harness: 'omp',
      agent_session_id: null,
    });
  });

  it('replays only recent successful messages and marks the interrupted user turn', () => {
    const s = service.createSession({ title: 'recovery', agent_harness: 'pi' });
    for (let index = 0; index < 11; index += 1) {
      service.addMessage(s.id, 'user', `question-${index}`);
      if (index < 10) {
        service.addMessage(s.id, 'assistant', `answer-${index}`);
      }
    }
    service.addMessage(s.id, 'assistant', 'failed marker', null, true);
    const current = service.addMessage(s.id, 'user', 'current request');

    const prompt = service.buildRecoveryPrompt(
      s.id,
      current.id,
      'current request',
    );

    expect(prompt).not.toContain('question-0');
    expect(prompt).toContain('answer-0');
    expect(prompt).not.toContain('failed marker');
    expect(prompt).toContain('question-10');
    expect(prompt).toContain(
      '[user — UNANSWERED: agent turn interrupted by server restart]',
    );
    expect(prompt.match(/current request/g)).toHaveLength(1);
  });

  it('clears restart recovery when a fresh continuation is stored', () => {
    const s = service.createSession({ title: 'recovery', agent_harness: 'pi' });
    const db = dbService.getDatabase();
    db.prepare(
      `UPDATE sessions SET agent_recovery_pending = 1 WHERE id = ?`,
    ).run(s.id);
    expect(service.isAgentRecoveryPending(s.id)).toBe(true);

    service.updateAgentContinuation(s.id, 'pi', '/tmp/fresh.jsonl');

    expect(service.isAgentRecoveryPending(s.id)).toBe(false);
  });

  it('updates title and legacy claude_session_id', () => {
    const s = service.createSession({ title: 'old' });
    const updated = service.updateSession(s.id, {
      title: 'new',
      claude_session_id: 'c-1',
    });
    expect(updated).toMatchObject({
      title: 'new',
      claude_session_id: 'c-1',
      agent_harness: 'claude',
      agent_session_id: 'c-1',
    });
  });

  it('deletes a session', () => {
    const s = service.createSession({ title: 't' });
    expect(service.deleteSession(s.id)).toBe(true);
    expect(service.getSession(s.id)).toBeNull();
  });
});
