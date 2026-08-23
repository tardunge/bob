#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function argsOf(argv) {
  const args = { yes: false, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--yes') args.yes = true;
    else if (value === '--force') args.force = true;
    else if (value.startsWith('--')) {
      const key = value.slice(2).replaceAll('-', '_');
      const next = argv[index + 1];
      if (!next || next.startsWith('--')) throw new Error(`${value} requires a value`);
      args[key] = next;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return args;
}

function platformDefaults() {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (!home) throw new Error('Cannot determine the user home directory.');
  if (process.platform === 'darwin') {
    const data = resolve(home, 'Library', 'Application Support', 'Bob');
    return { data, profiles: resolve(data, 'profiles') };
  }
  if (process.platform === 'win32') {
    const config = process.env.APPDATA || resolve(home, 'AppData', 'Roaming');
    const data = process.env.LOCALAPPDATA || resolve(home, 'AppData', 'Local');
    return { data: resolve(data, 'Bob'), profiles: resolve(config, 'Bob', 'profiles') };
  }
  const config = process.env.XDG_CONFIG_HOME || resolve(home, '.config');
  const data = process.env.XDG_DATA_HOME || resolve(home, '.local', 'share');
  return { data: resolve(data, 'bob'), profiles: resolve(config, 'bob', 'profiles') };
}

function commandAvailable(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore', timeout: 5_000 });
  return !result.error || result.error.code !== 'ENOENT';
}

function parseEnv(content) {
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function updateEnv(content, values) {
  const pending = new Map(Object.entries(values).filter(([, value]) => value !== ''));
  const lines = content ? content.split(/\r?\n/) : [];
  const updated = lines.map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    if (!match || !pending.has(match[1])) return line;
    const replacement = `${match[1]}=${pending.get(match[1])}`;
    pending.delete(match[1]);
    return replacement;
  });
  if (updated.length && updated.at(-1) !== '') updated.push('');
  for (const [key, value] of pending) updated.push(`${key}=${value}`);
  return `${updated.join('\n').replace(/\n+$/, '')}\n`;
}

async function main() {
  const args = argsOf(process.argv.slice(2));
  const defaults = platformDefaults();
  const envFile = resolve(args.config || resolve(root, '.env'));
  const existing = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  const current = parseEnv(existing);
  const availableHarnesses = ['pi', 'omp', 'claude'].filter(commandAvailable);
  const defaultHarness = current.BOB_AGENT_HARNESS || availableHarnesses[0] || 'pi';
  const rl = args.yes ? null : createInterface({ input, output });
  const ask = async (question, fallback) => {
    if (!rl) return fallback;
    const answer = (await rl.question(`${question} [${fallback}]: `)).trim();
    return answer || fallback;
  };
  const askOptional = async (question, currentValue = '') => {
    if (!rl) return currentValue;
    const suffix = currentValue ? ` [${currentValue}]` : ' (optional)';
    const answer = (await rl.question(`${question}${suffix}: `)).trim();
    return answer || currentValue;
  };

  console.log('\nBob setup\nSafe defaults: localhost only, read-only sample profile, no remote mode.\n');
  try {
    const workspace = resolve(args.workspace || await ask('Workspace directory', current.BOB_WORKSPACE_PATH || process.cwd()));
    const profiles = resolve(args.profiles_dir || await ask('Profiles directory', current.BOB_PROFILES_PATH || defaults.profiles));
    const data = resolve(args.data_dir || await ask('Data directory', current.DATABASE_PATH ? dirname(current.DATABASE_PATH) : defaults.data));
    const harness = args.harness || await ask(`Agent harness (${availableHarnesses.join(', ') || 'none detected'})`, defaultHarness);
    if (!['pi', 'omp', 'claude'].includes(harness)) throw new Error(`Unsupported harness: ${harness}`);
    if (!existsSync(workspace)) throw new Error(`Workspace does not exist: ${workspace}`);
    const whisperModel = args.whisper_model || await askOptional(
      'Whisper .bin model path',
      current.BOB_WHISPER_MODEL_PATH,
    );
    const piperModel = args.piper_model || await askOptional(
      'Piper .onnx voice path',
      current.BOB_PIPER_MODEL_PATH,
    );
    for (const [label, modelPath] of [
      ['Whisper model', whisperModel],
      ['Piper voice', piperModel],
    ]) {
      if (modelPath && !existsSync(resolve(modelPath))) {
        throw new Error(`${label} does not exist: ${modelPath}`);
      }
    }

    const summary = [
      `Workspace: ${workspace}`,
      `Profiles:  ${profiles}`,
      `Data:      ${data}`,
      `Harness:   ${harness}`,
      `Config:    ${envFile}`,
      `Whisper:   ${whisperModel ? resolve(whisperModel) : 'configure later'}`,
      `Piper:     ${piperModel ? resolve(piperModel) : 'configure later'}`,
    ].join('\n');
    console.log(`\n${summary}\n`);
    if (rl && !args.force) {
      const confirmation = (await rl.question('Write this configuration? [Y/n]: ')).trim().toLowerCase();
      if (confirmation && confirmation !== 'y' && confirmation !== 'yes') {
        console.log('Setup cancelled.');
        return;
      }
    }

    mkdirSync(data, { recursive: true });
    mkdirSync(profiles, { recursive: true });
    const sampleTarget = resolve(profiles, 'sample');
    if (!existsSync(sampleTarget)) cpSync(resolve(root, 'profiles', 'sample'), sampleTarget, { recursive: true });
    mkdirSync(dirname(envFile), { recursive: true });

    const harnessBinary = current[`BOB_${harness.toUpperCase()}_BINARY`] || harness;
    const values = {
      BOB_WORKSPACE_PATH: workspace,
      BOB_PROFILES_PATH: profiles,
      BOB_DEFAULT_PROFILE: current.BOB_DEFAULT_PROFILE || 'sample',
      BOB_AGENT_HARNESS: harness,
      [`BOB_${harness.toUpperCase()}_BINARY`]: harnessBinary,
      BOB_WHISPER_BINARY: current.BOB_WHISPER_BINARY || 'whisper-cli',
      BOB_FFMPEG_BINARY: current.BOB_FFMPEG_BINARY || 'ffmpeg',
      BOB_PIPER_BINARY: current.BOB_PIPER_BINARY || 'piper',
      BOB_WHISPER_MODEL_PATH: whisperModel ? resolve(whisperModel) : '',
      BOB_PIPER_MODEL_PATH: piperModel ? resolve(piperModel) : '',
      BOB_HOST: '127.0.0.1',
      BOB_PORT: current.BOB_PORT || '5556',
      BOB_UI_HOST: '127.0.0.1',
      BOB_UI_PORT: current.BOB_UI_PORT || '5555',
      BOB_UI_ALLOWED_HOSTS: 'localhost,127.0.0.1',
      BOB_ALLOWED_ORIGINS: 'http://127.0.0.1:5555,http://localhost:5555',
      DATABASE_PATH: resolve(data, 'bob.db'),
      BOB_PI_SESSION_DIR: resolve(data, 'agent-sessions', 'pi'),
      BOB_OMP_SESSION_DIR: resolve(data, 'agent-sessions', 'omp'),
    };
    const target = `${envFile}.${process.pid}.tmp`;
    writeFileSync(target, updateEnv(existing, values), { mode: 0o600 });
    renameSync(target, envFile);

    console.log('\nConfiguration written. Next:\n  npm run doctor\n  npm run smoke:offline\n  npm run dev\n');
    if (!commandAvailable(harnessBinary)) {
      console.warn(`Install and authenticate '${harnessBinary}' before the first provider-backed turn.`);
    }
  } finally {
    rl?.close();
  }
}

main().catch((error) => {
  console.error(`Setup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
