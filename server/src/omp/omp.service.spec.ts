import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { ProfileConfig } from '../profiles';
import { OmpService } from './omp.service';

const config = (cwd: string): ProfileConfig => ({
  id: 'test',
  displayName: 'Test',
  description: 'Test profile',
  path: cwd,
  defaultHarness: 'omp',
  cwd,
  systemPrompt: null,
  systemPromptPath: null,
  readRoots: ['.'],
  allowedTools: [],
  writeRoots: [],
  operatorCommands: [],
  additionalTools: [],
  webResearch: false,
  timeoutMs: 10_000,
  models: {},
  piperModelPath: null,
  whisperPrompt: null,
  whisperTimeoutMs: 10_000,
  skillsPath: null,
  mcpConfigPath: null,
  piExtensions: [],
  ompExtensions: [],
});

describe('OmpService', () => {
  let root: string;
  let previousBinary: string | undefined;
  let previousSessions: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bob-omp-service-'));
    previousBinary = process.env.BOB_OMP_BINARY;
    previousSessions = process.env.BOB_OMP_SESSION_DIR;
  });

  afterEach(() => {
    if (previousBinary === undefined) delete process.env.BOB_OMP_BINARY;
    else process.env.BOB_OMP_BINARY = previousBinary;
    if (previousSessions === undefined) delete process.env.BOB_OMP_SESSION_DIR;
    else process.env.BOB_OMP_SESSION_DIR = previousSessions;
    rmSync(root, { recursive: true, force: true });
  });

  it('runs the documented OMP RPC lifecycle and returns continuation state', async () => {
    const binary = join(root, 'fake-omp.mjs');
    const argsFile = join(root, 'args.json');
    writeFileSync(
      binary,
      `#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.ARGS_FILE, JSON.stringify(process.argv.slice(2)));
const send = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
let stats = 0;
send({ type: 'ready', protocolVersion: 1 });
createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line);
  if (command.type === 'get_session_stats') {
    stats += 1;
    send({ type: 'response', id: command.id, command: command.type, success: true, data: {
      tokens: { input: stats * 10, output: stats * 2, cacheRead: stats, cacheWrite: 0 },
      cost: { total: stats * 0.01 }, contextUsage: { tokens: 123, contextWindow: 272000 }
    }});
  } else if (command.type === 'prompt') {
    send({ type: 'response', id: command.id, command: command.type, success: true });
    send({ type: 'agent_end' });
  } else if (command.type === 'get_last_assistant_text') {
    send({ type: 'response', id: command.id, command: command.type, success: true, data: { text: 'OMP verified' } });
  } else if (command.type === 'get_state') {
    send({ type: 'response', id: command.id, command: command.type, success: true, data: { sessionFile: '/tmp/omp-session.jsonl' } });
  }
});
`,
    );
    chmodSync(binary, 0o755);
    process.env.BOB_OMP_BINARY = binary;
    process.env.BOB_OMP_SESSION_DIR = join(root, 'sessions');
    process.env.ARGS_FILE = argsFile;

    const service = new OmpService();
    const result = await service.run({
      userMessage: 'verify',
      harness: 'omp',
      profile: 'test',
      config: config(root),
    });

    expect(service.capabilities).toEqual({
      background: true,
      recursiveTermination: true,
      enforcedWriteRoots: true,
    });
    expect(result).toEqual({
      displayText: 'OMP verified',
      speechText: 'OMP verified',
      continuation: { harness: 'omp', sessionId: '/tmp/omp-session.jsonl' },
      usage: {
        inputTokens: 10,
        outputTokens: 2,
        cacheReadTokens: 1,
        cacheCreationTokens: 0,
        costUsd: 0.01,
        contextTokens: 123,
        contextWindow: 272000,
      },
    });
    const args = JSON.parse(readFileSync(argsFile, 'utf8')) as string[];
    expect(args).toContain('--no-extensions');
    expect(args).toContain('--mode');
    expect(args).toContain('rpc');
    expect(args).toContain('--session-dir');
    expect(args).toContain('--extension');
    expect(args.some((value) => value.endsWith('/pi/profile-extension.ts'))).toBe(true);
  });
});
