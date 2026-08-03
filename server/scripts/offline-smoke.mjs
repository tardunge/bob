import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { join, resolve } from 'node:path';

const temp = await mkdtemp(join(tmpdir(), 'bob-offline-smoke-'));
process.env.BOB_TEST_MODE = 'offline';
process.env.BOB_TEST_TRANSCRIPT = 'Offline smoke transcript';
process.env.BOB_AGENT_HARNESS = 'pi';
process.env.BOB_DEFAULT_PROFILE = 'sample';
process.env.BOB_PROFILES_PATH = resolve('../profiles');
process.env.BOB_WORKSPACE_PATH = resolve('..');
process.env.DATABASE_PATH = join(temp, 'smoke.db');

const [{ NestFactory }, { AppModule }] = await Promise.all([
  import('@nestjs/core'),
  import('../dist/app.module.js'),
]);

async function startApp() {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') {
    throw new Error('No smoke-test port');
  }
  return { app, base: `http://127.0.0.1:${address.port}/api` };
}

let { app, base } = await startApp();

try {
  const createdResponse = await fetch(`${base}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profile: 'sample' }),
  });
  if (!createdResponse.ok) throw new Error(await createdResponse.text());
  const session = await createdResponse.json();
  if (session.agent_harness !== 'pi') throw new Error('Pi is not the default harness');

  const form = new FormData();
  form.append('audio', new Blob(['offline'], { type: 'audio/wav' }), 'smoke.wav');
  form.append('sessionId', session.id);
  form.append('harness', 'pi');
  const accepted = await fetch(`${base}/voice`, { method: 'POST', body: form });
  if (accepted.status !== 201) throw new Error(await accepted.text());

  let completed;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(`${base}/sessions/${session.id}`);
    completed = await response.json();
    if (completed.messages?.length >= 2) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  const assistant = completed?.messages?.find((message) => message.role === 'assistant');
  if (!assistant?.content?.startsWith('Offline test response:')) {
    throw new Error('Offline assistant response was not persisted');
  }

  const recoveryResponse = await fetch(`${base}/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ profile: 'sample' }),
  });
  if (!recoveryResponse.ok) throw new Error(await recoveryResponse.text());
  const recoverySession = await recoveryResponse.json();
  const database = new Database(process.env.DATABASE_PATH);
  database
    .prepare(
      `UPDATE sessions SET agent_session_id = ?, agent_harness = 'pi' WHERE id = ?`,
    )
    .run('/stale/pi-session.jsonl', recoverySession.id);
  database
    .prepare(`INSERT INTO messages (session_id, role, content) VALUES (?, 'user', ?)`)
    .run(recoverySession.id, 'interrupted request');
  database
    .prepare(
      `INSERT INTO turns (id, session_id, harness, state, stage)
       VALUES (?, ?, 'pi', 'processing', 'agent')`,
    )
    .run(randomUUID(), recoverySession.id);
  database.close();

  await app.close();
  ({ app, base } = await startApp());

  const reconciledDatabase = new Database(process.env.DATABASE_PATH);
  const reconciled = reconciledDatabase
    .prepare(
      `SELECT s.agent_recovery_pending AS pending, t.state, t.error
       FROM sessions s
       JOIN turns t ON t.session_id = s.id
       WHERE s.id = ?
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT 1`,
    )
    .get(recoverySession.id);
  reconciledDatabase.close();
  if (
    reconciled?.pending !== 1 ||
    reconciled?.state !== 'failed' ||
    !String(reconciled?.error).includes('server restarted')
  ) {
    throw new Error('Interrupted Pi turn was not reconciled on restart');
  }

  process.env.BOB_TEST_TRANSCRIPT = 'Recovery follow-up';
  const recoveryForm = new FormData();
  recoveryForm.append(
    'audio',
    new Blob(['offline'], { type: 'audio/wav' }),
    'recovery.wav',
  );
  recoveryForm.append('sessionId', recoverySession.id);
  recoveryForm.append('harness', 'pi');
  const recoveryAccepted = await fetch(`${base}/voice`, {
    method: 'POST',
    body: recoveryForm,
  });
  if (recoveryAccepted.status !== 201) {
    throw new Error(await recoveryAccepted.text());
  }

  let recovered;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await fetch(`${base}/sessions/${recoverySession.id}`);
    recovered = await response.json();
    if (recovered.messages?.length >= 3) break;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  const recoveryAssistant = recovered?.messages?.findLast(
    (message) => message.role === 'assistant' && !message.is_error,
  );
  const recoveryText = recoveryAssistant?.content ?? '';
  if (
    !recoveryText.includes('A previous Pi continuation was interrupted') ||
    !recoveryText.includes(
      '[user — UNANSWERED: agent turn interrupted by server restart]',
    ) ||
    !recoveryText.includes('interrupted request') ||
    recoveryText.split('Recovery follow-up').length !== 2
  ) {
    throw new Error('Fresh Pi continuation did not receive recovery context');
  }

  const recoveredDatabase = new Database(process.env.DATABASE_PATH);
  const recoveredSession = recoveredDatabase
    .prepare(
      `SELECT agent_recovery_pending AS pending, agent_session_id
       FROM sessions WHERE id = ?`,
    )
    .get(recoverySession.id);
  recoveredDatabase.close();
  if (recoveredSession?.pending !== 0 || recoveredSession?.agent_session_id !== null) {
    throw new Error('Recovered session retained stale Pi continuation state');
  }
  console.log(`Offline smoke passed: session=${session.id}, messages=${completed.messages.length}`);
} finally {
  await app.close();
  await rm(temp, { recursive: true, force: true });
}
