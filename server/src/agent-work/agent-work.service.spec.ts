import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { DatabaseService } from '../database/database.service';
import { SessionService } from '../session/session.service';
import type { AgentTurnResult, ManagedAgentRun } from '../agent/agent.types';
import { AgentWorkService } from './agent-work.service';
import { AgentWorkStore } from './agent-work.store';
import * as profiles from '../profiles';

const RESULT: AgentTurnResult = {
  displayText: 'completed work',
  speechText: 'completed work',
  continuation: { harness: 'pi', sessionId: '/state/continued.jsonl' },
  usage: null,
};
const BASE_PROFILE = profiles.getProfileConfig(profiles.DEFAULT_PROFILE);


function runtimeCapabilities(harness: 'pi' | 'claude') {
  return {
    background: harness === 'pi',
    recursiveTermination: harness === 'pi',
    enforcedWriteRoots: harness === 'pi',
  };
}

describe('AgentWorkService', () => {
  let database: DatabaseService;
  let sessions: SessionService;
  let service: AgentWorkService;
  let store: AgentWorkStore;
  let dbPath: string;
  const previousDatabasePath = process.env.DATABASE_PATH;
  const previousTestMode = process.env.BOB_TEST_MODE;
  const previousPromotionMs = process.env.BOB_TEST_PROMOTION_MS;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-18T12:00:00Z'));
    jest.spyOn(profiles, 'getProfileConfig').mockReturnValue({
      ...BASE_PROFILE,
      piExtensions: [],
    });
    dbPath = join(tmpdir(), `bob-agent-work-${randomUUID()}.db`);
    process.env.DATABASE_PATH = dbPath;
    process.env.BOB_TEST_MODE = 'offline';
    delete process.env.BOB_TEST_PROMOTION_MS;
    database = new DatabaseService();
    database.onModuleInit();
    sessions = new SessionService(database);
    service = new AgentWorkService(
      database,
      { capabilitiesFor: runtimeCapabilities } as never,
      sessions,
    );
    store = new AgentWorkStore(database.getDatabase());
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    database.getDatabase().close();
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(dbPath + suffix)) unlinkSync(dbPath + suffix);
    }
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousTestMode === undefined) delete process.env.BOB_TEST_MODE;
    else process.env.BOB_TEST_MODE = previousTestMode;
    if (previousPromotionMs === undefined) delete process.env.BOB_TEST_PROMOTION_MS;
    else process.env.BOB_TEST_PROMOTION_MS = previousPromotionMs;
  });

  it('promotes supported Pi work at the exact 120-second agent boundary', () => {
    const session = sessions.createSession({ title: 'promotion' });
    const admission = service.admitTurn(session.id, 'pi');
    const entered = service.enterAgent(admission.work.id);
    const deadline = entered.profile_deadline_at_ms;

    jest.advanceTimersByTime(119_999);
    expect(service.get(admission.work.id).state).toBe('foreground');
    jest.advanceTimersByTime(1);
    const promoted = service.get(admission.work.id);
    expect(promoted.state).toBe('background');
    expect(promoted.profile_deadline_at_ms).toBe(deadline);
    expect(service.hasForeground(session.id)).toBe(false);
  });


  it('keeps unsupported adapters foreground and rejects overlapping foreground admission', () => {
    const session = sessions.createSession({
      title: 'unsupported',
      agent_harness: 'claude',
    });
    const admission = service.admitTurn(session.id, 'claude');
    service.enterAgent(admission.work.id);
    expect(() => service.admitTurn(session.id, 'claude')).toThrow(
      /foreground Agent Work/,
    );

    jest.advanceTimersByTime(600_000);
    expect(service.get(admission.work.id)).toMatchObject({
      state: 'foreground',
      background_supported: 0,
    });
  });
  it('keeps Pi foreground when a profile loads unrestricted extensions', () => {
    const base = profiles.getProfileConfig(profiles.DEFAULT_PROFILE);
    jest.mocked(profiles.getProfileConfig).mockReturnValue({
      ...base,
      piExtensions: ['/trusted/unrestricted-extension.ts'],
    });
    const session = sessions.createSession({
      title: 'extension',
      profile: profiles.DEFAULT_PROFILE,
    });
    const admission = service.admitTurn(session.id, 'pi');
    service.enterAgent(admission.work.id);

    expect(service.get(admission.work.id)).toMatchObject({
      background_supported: 0,
      write_roots: ['/'],
    });
    jest.advanceTimersByTime(120_000);
    expect(service.get(admission.work.id).state).toBe('foreground');
  });

  it('preserves canonical continuation when a successful adapter returns none', () => {
    const session = sessions.createSession({ title: 'continuation' });
    database
      .getDatabase()
      .prepare(
        `UPDATE sessions
         SET agent_session_id = '/state/stable.jsonl'
         WHERE id = ?`,
      )
      .run(session.id);
    const admission = service.admitTurn(session.id, 'pi');
    service.enterAgent(admission.work.id);
    service.claimCompletion(admission.work.id);
    service.finishSuccess(admission.work.id, {
      ...RESULT,
      continuation: null,
    });

    expect(
      database
        .getDatabase()
        .prepare(
          `SELECT agent_session_id, agent_recovery_pending AS pending
           FROM sessions WHERE id = ?`,
        )
        .get(session.id),
    ).toEqual({ agent_session_id: '/state/stable.jsonl', pending: 0 });
  });

  it('clears a stale Pi continuation after a successful recovery turn', () => {
    const session = sessions.createSession({ title: 'recovery' });
    database
      .getDatabase()
      .prepare(
        `UPDATE sessions
         SET agent_session_id = '/state/stale.jsonl', agent_recovery_pending = 1
         WHERE id = ?`,
      )
      .run(session.id);
    const admission = service.admitTurn(session.id, 'pi');
    service.enterAgent(admission.work.id);
    service.claimCompletion(admission.work.id);
    service.finishSuccess(admission.work.id, {
      ...RESULT,
      continuation: null,
    });

    expect(
      database
        .getDatabase()
        .prepare(
          `SELECT agent_session_id, agent_recovery_pending AS pending
           FROM sessions WHERE id = ?`,
        )
        .get(session.id),
    ).toEqual({ agent_session_id: null, pending: 0 });
  });

  it('lets completion win the promotion race without a callback', () => {
    const session = sessions.createSession({ title: 'foreground completion' });
    const admission = service.admitTurn(session.id, 'pi');
    service.enterAgent(admission.work.id);
    jest.advanceTimersByTime(119_999);

    expect(service.claimCompletion(admission.work.id)?.state).toBe('settling');
    const terminal = service.finishSuccess(admission.work.id, RESULT, null, false);
    jest.advanceTimersByTime(1);

    expect(terminal).toMatchObject({ committed: true, wasBackground: false });
    expect(service.get(admission.work.id)).toMatchObject({
      state: 'succeeded',
      speech_suppressed: 0,
      stage: 'piper',
    });
    expect(service.hasForeground(session.id)).toBe(true);
    service.publishSuccess(admission.work.id, null, false);
    expect(service.hasForeground(session.id)).toBe(false);
    expect(
      database
        .getDatabase()
        .prepare(`SELECT count(*) AS count FROM background_callbacks`)
        .get(),
    ).toEqual({ count: 0 });
  });

  it('persists one callback and acknowledges its exact batch on continuation advance', () => {
    const session = sessions.createSession({ title: 'callbacks' });
    const first = service.admitTurn(session.id, 'pi');
    service.enterAgent(first.work.id);
    jest.advanceTimersByTime(120_000);
    expect(service.claimCompletion(first.work.id)?.state).toBe('settling');
    const background = service.finishSuccess(first.work.id, RESULT, null, false);
    expect(background.wasBackground).toBe(true);
    expect(service.get(first.work.id)?.stage).toBe('piper');
    expect(service.hasForeground(session.id)).toBe(false);
    service.publishSuccess(first.work.id, null, true);
    expect(service.get(first.work.id)?.stage).toBeNull();

    const callback = database
      .getDatabase()
      .prepare(`SELECT * FROM background_callbacks`)
      .get() as { id: string; delivery_state: string; terminal_sequence: number };
    expect(callback).toMatchObject({
      id: `agent-work:${first.work.id}`,
      delivery_state: 'pending',
      terminal_sequence: 1,
    });

    const second = service.admitTurn(session.id, 'pi');
    service.enterAgent(second.work.id);
    const prepared = service.prepare(second.work.id, 'next request', null);
    expect(prepared.prompt).toContain(callback.id);
    expect(prepared.prompt).toContain('completed work');
    expect(service.claimCompletion(second.work.id)?.state).toBe('settling');
    service.finishSuccess(second.work.id, RESULT);

    expect(
      database
        .getDatabase()
        .prepare(`SELECT delivery_state FROM background_callbacks WHERE id = ?`)
        .get(callback.id),
    ).toEqual({ delivery_state: 'acknowledged' });
    const messageCount = database
      .getDatabase()
      .prepare(`SELECT count(*) AS count FROM messages WHERE session_id = ?`)
      .get(session.id) as { count: number };
    service.finishSuccess(second.work.id, RESULT);
    expect(
      database
        .getDatabase()
        .prepare(`SELECT count(*) AS count FROM messages WHERE session_id = ?`)
        .get(session.id),
    ).toEqual(messageCount);
  });

  it('uses read-only admission for overlapping active write roots and releases the lease terminally', async () => {
    const firstSession = sessions.createSession({ title: 'writer one' });
    const secondSession = sessions.createSession({ title: 'writer two' });
    const root = '/tmp/bob-workspace/project';
    const first = store.admit(
      firstSession.id,
      'pi',
      600_000,
      [root],
      true,
      true,
    );
    store.enterAgent(first.work.id, Date.now(), 120_000);
    store.promote(first.work.id);

    const second = store.admit(
      secondSession.id,
      'pi',
      600_000,
      [`${root}/nested`],
      true,
      true,
    );
    expect(JSON.parse(second.work.write_roots_json)).toEqual([]);
    expect(second.work.read_only_reason).toContain('overlapping write root');

    await service.finishFailure(
      first.work.id,
      'cancelled',
      'cancelled',
      'cancelled',
    );
    const thirdSession = sessions.createSession({ title: 'writer three' });
    const third = store.admit(
      thirdSession.id,
      'pi',
      600_000,
      [root],
      true,
      true,
    );
    expect(JSON.parse(third.work.write_roots_json)).toEqual([root]);
  });


  it('claims at most 20 callbacks in terminal-sequence order', () => {
    const session = sessions.createSession({ title: 'callback batch' });
    for (let index = 0; index < 21; index += 1) {
      const admission = service.admitTurn(session.id, 'pi');
      store.enterAgent(admission.work.id, Date.now(), 120_000);
      store.promote(admission.work.id);
      expect(service.claimCompletion(admission.work.id)?.state).toBe(
        'settling',
      );
      service.finishSuccess(admission.work.id, {
        ...RESULT,
        displayText: `callback ${index + 1}`,
      });
    }

    const receiver = service.admitTurn(session.id, 'pi');
    store.enterAgent(receiver.work.id, Date.now(), 120_000);
    const prepared = service.prepare(receiver.work.id, 'continue', null);
    const callbackStates = database
      .getDatabase()
      .prepare(
        `SELECT terminal_sequence, delivery_state
         FROM background_callbacks
         ORDER BY terminal_sequence`,
      )
      .all() as Array<{ terminal_sequence: number; delivery_state: string }>;
    expect(callbackStates.filter((row) => row.delivery_state === 'claimed')).toHaveLength(
      20,
    );
    expect(callbackStates.at(-1)).toEqual({
      terminal_sequence: 21,
      delivery_state: 'pending',
    });
    expect(prepared.prompt.indexOf('callback 1')).toBeLessThan(
      prepared.prompt.indexOf('callback 20'),
    );
    expect(prepared.prompt).not.toContain('callback 21');
  });
  it('cancels a background managed run only after its termination resolves', async () => {
    const session = sessions.createSession({ title: 'cancel' });
    const admission = service.admitTurn(session.id, 'pi');
    service.enterAgent(admission.work.id);
    jest.advanceTimersByTime(120_000);
    const order: string[] = [];
    const run: ManagedAgentRun = {
      capabilities: runtimeCapabilities('pi'),
      processIdentity: null,
      runId: 'adapter-run-1',
      continuationBranch: '/state/branches/adapter-run-1',
      activate: null,
      result: Promise.resolve(RESULT),
      terminate: async () => {
        order.push('terminated');
      },
    };
    service.attachRun(admission.work.id, run);
    expect(service.get(admission.work.id)).toMatchObject({
      adapter_run_id: 'adapter-run-1',
      continuation_branch: '/state/branches/adapter-run-1',
    });

    const cancelled = await service.cancel(admission.work.id);
    order.push(cancelled.state);
    expect(order).toEqual(['terminated', 'cancelled']);
    expect(cancelled.speech_suppressed).toBe(1);
    expect(
      database
        .getDatabase()
        .prepare(`SELECT count(*) AS count FROM background_callbacks`)
        .get(),
    ).toEqual({ count: 1 });
  });

  it('does not replace newer continuation recovery with an interrupted promoted fork', async () => {
    const session = sessions.createSession({ title: 'promoted recovery' });
    const promoted = service.admitTurn(session.id, 'pi');
    service.enterAgent(promoted.work.id);
    jest.advanceTimersByTime(120_000);
    const newer = service.admitTurn(session.id, 'pi');
    service.enterAgent(newer.work.id);
    service.claimCompletion(newer.work.id);
    service.finishSuccess(newer.work.id, RESULT);

    await service.finishFailure(
      promoted.work.id,
      'interrupted',
      'Interrupted promoted work.',
      'restart',
    );

    expect(sessions.isAgentRecoveryPending(session.id)).toBe(false);
  });

  it('keeps unmanaged agent-stage work orphaned during startup reconciliation', async () => {
    const session = sessions.createSession({
      title: 'unmanaged startup',
      agent_harness: 'claude',
    });
    const admission = service.admitTurn(session.id, 'claude');
    store.enterAgent(admission.work.id, Date.now(), 120_000);
    process.env.BOB_TEST_MODE = 'production';
    try {
      await service.onApplicationBootstrap();
    } finally {
      process.env.BOB_TEST_MODE = 'offline';
    }

    expect(service.get(admission.work.id).state).toBe('orphaned');
    expect(service.hasForeground(session.id)).toBe(true);
  });

  it('publishes orphaned ownership without releasing the foreground slot', () => {
    const session = sessions.createSession({ title: 'orphan event' });
    const admission = service.admitTurn(session.id, 'pi');
    service.enterAgent(admission.work.id);
    const actions: string[] = [];
    const subscription = service
      .stream()
      .subscribe((event) => actions.push(event.action));

    const orphaned = service.markOrphaned(
      admission.work.id,
      'Termination could not be verified.',
    );

    expect(orphaned.state).toBe('orphaned');
    expect(service.hasForeground(session.id)).toBe(true);
    expect(actions).toEqual(['orphaned']);
    subscription.unsubscribe();
  });

  it('fails closed when startup cannot verify an agent-stage Pi process', async () => {
    const session = sessions.createSession({ title: 'orphan' });
    const admission = service.admitTurn(session.id, 'pi');
    store.enterAgent(admission.work.id, Date.now(), 120_000);

    await service.onApplicationBootstrap();

    expect(service.get(admission.work.id).state).toBe('orphaned');
    expect(service.hasForeground(session.id)).toBe(true);
  });
});
