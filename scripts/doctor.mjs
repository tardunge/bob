#!/usr/bin/env node
import { constants, accessSync, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configFlag = process.argv.indexOf('--config');
const envPath = resolve(
  configFlag >= 0 && process.argv[configFlag + 1]
    ? process.argv[configFlag + 1]
    : resolve(root, '.env'),
);
if (existsSync(envPath)) loadEnvFile(envPath);

const results = [];
const add = (level, name, detail) => results.push({ level, name, detail });
const pathExists = (value, kind = 'file') => {
  if (!value || !isAbsolute(value) || !existsSync(value)) return false;
  const stat = statSync(value);
  return kind === 'directory' ? stat.isDirectory() : stat.isFile();
};
const commandAvailable = (command) => {
  if (!command) return false;
  if (command.includes('/') || command.includes('\\')) {
    try {
      accessSync(command, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  const probe = spawnSync(command, ['--version'], {
    encoding: 'utf8',
    stdio: 'ignore',
    timeout: 5_000,
  });
  return !probe.error || probe.error.code !== 'ENOENT';
};
const isLoopback = (host) =>
  ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host.toLowerCase());

const nodeMajor = Number(process.versions.node.split('.')[0]);
add(nodeMajor >= 22 ? 'pass' : 'fail', 'Node.js', `v${process.versions.node} (22+ required)`);
add(existsSync(envPath) ? 'pass' : 'fail', 'Configuration', existsSync(envPath) ? envPath : 'Run npm run setup');

const workspace = process.env.BOB_WORKSPACE_PATH;
add(pathExists(workspace, 'directory') ? 'pass' : 'fail', 'Workspace', workspace || 'BOB_WORKSPACE_PATH is not set');

const profilesPath = process.env.BOB_PROFILES_PATH;
const profile = process.env.BOB_DEFAULT_PROFILE || 'sample';
const profileManifest = profilesPath ? resolve(profilesPath, profile, 'profile.json') : '';
add(pathExists(profileManifest) ? 'pass' : 'fail', 'Profile', profileManifest || 'BOB_PROFILES_PATH is not set');

const databasePath = process.env.DATABASE_PATH;
let databaseReady = Boolean(databasePath && isAbsolute(databasePath));
if (databaseReady) {
  try {
    accessSync(dirname(databasePath), constants.W_OK);
  } catch {
    databaseReady = false;
  }
}
add(databaseReady ? 'pass' : 'fail', 'Data directory', databasePath || 'DATABASE_PATH is not set');

const harness = process.env.BOB_AGENT_HARNESS || 'pi';
const harnesses = {
  pi: process.env.BOB_PI_BINARY || 'pi',
  omp: process.env.BOB_OMP_BINARY || 'omp',
  claude: process.env.BOB_CLAUDE_BINARY || 'claude',
};
const harnessBinary = harnesses[harness];
add(
  harnessBinary && commandAvailable(harnessBinary) ? 'pass' : 'fail',
  'Agent harness',
  harnessBinary ? `${harness} (${harnessBinary})` : `Unsupported harness: ${harness}`,
);

for (const [name, variable, fallback] of [
  ['Whisper', 'BOB_WHISPER_BINARY', 'whisper-cli'],
  ['FFmpeg', 'BOB_FFMPEG_BINARY', 'ffmpeg'],
  ['Piper', 'BOB_PIPER_BINARY', 'piper'],
]) {
  const binary = process.env[variable] || fallback;
  const available = commandAvailable(binary);
  add(available ? 'pass' : 'warn', name, available ? binary : `${binary} not found; voice turns are not ready`);
}
for (const [name, variable] of [
  ['Whisper model', 'BOB_WHISPER_MODEL_PATH'],
  ['Piper voice', 'BOB_PIPER_MODEL_PATH'],
]) {
  const value = process.env[variable];
  add(pathExists(value) ? 'pass' : 'warn', name, value || `${variable} is not set`);
}

const apiHost = process.env.BOB_HOST || '127.0.0.1';
const uiHost = process.env.BOB_UI_HOST || '127.0.0.1';
const exposed = !isLoopback(apiHost) || !isLoopback(uiHost);
const remoteMode = process.env.BOB_REMOTE_MODE;
add(
  !exposed || remoteMode === 'proxy' ? 'pass' : 'fail',
  'Network policy',
  exposed ? `non-loopback binding requires BOB_REMOTE_MODE=proxy` : 'localhost only',
);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ok: !results.some((result) => result.level === 'fail'), results }, null, 2));
} else {
  console.log('\nBob doctor\n');
  const symbols = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' };
  for (const result of results) {
    console.log(`${symbols[result.level].padEnd(4)}  ${result.name.padEnd(16)} ${result.detail}`);
  }
  console.log('');
}

process.exitCode = results.some((result) => result.level === 'fail') ? 1 : 0;
