import { existsSync, readFileSync, readdirSync } from 'fs';
import { loadEnvFile } from 'process';
import { isAbsolute, join, resolve } from 'path';

const REPOSITORY_ROOT = resolve(__dirname, '../..');
const ENV_FILE = join(REPOSITORY_ROOT, '.env');
if (existsSync(ENV_FILE)) loadEnvFile(ENV_FILE);

export type SessionProfile = string;

export interface ProfileConfig {
  id: string;
  displayName: string;
  description: string;
  path: string;
  defaultHarness: 'pi' | 'claude';
  cwd: string;
  systemPrompt: string | null;
  systemPromptPath: string | null;
  readRoots: string[];
  allowedTools: string[];
  writeRoots: string[];
  timeoutMs: number;
  models: { pi?: string; claude?: string };
  piperModelPath: string | null;
  whisperPrompt: string | null;
  whisperTimeoutMs: number;
  skillsPath: string | null;
  mcpConfigPath: string | null;
  piExtensions: string[];
}

interface ProfileManifest {
  version: number;
  id: string;
  displayName: string;
  description?: string;
  systemPrompt?: string | null;
  defaultHarness?: 'pi' | 'claude';
  models?: { pi?: string; claude?: string };
  voice?: {
    whisperPrompt?: string | null;
    whisperTimeoutMs?: number;
    piperModelPath?: string | null;
  };
  permissions?: {
    readRoots?: string[];
    writeRoots?: string[];
    operatorCommands?: string[];
    additionalTools?: string[];
    webResearch?: boolean;
  };
  skillsDirectory?: string | null;
  mcpConfig?: string | null;
  piExtensions?: string[];
  timeoutMs?: number;
}

function profileError(path: string, message: string): never {
  throw new Error(`Invalid Bob profile at ${path}: ${message}`);
}

function requireString(value: unknown, field: string, source: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    profileError(source, `${field} must be a non-empty string`);
  }
  return value.trim();
}

function stringArray(value: unknown, field: string, source: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    profileError(source, `${field} must be an array of strings`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function resolveProfilePath(profilePath: string, configured?: string | null): string | null {
  if (!configured) return null;
  return isAbsolute(configured) ? configured : resolve(profilePath, configured);
}

export function resolveWorkspacePath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolve(env.BOB_WORKSPACE_PATH || REPOSITORY_ROOT);
}

export function resolveProfilesPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolve(env.BOB_PROFILES_PATH || join(REPOSITORY_ROOT, 'profiles'));
}

export function loadProfiles(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, ProfileConfig> {
  const profilesPath = resolveProfilesPath(env);
  if (!existsSync(profilesPath)) {
    throw new Error(
      `Bob profiles directory not found: ${profilesPath}. Set BOB_PROFILES_PATH or copy profiles/sample.`,
    );
  }

  const workspace = resolveWorkspacePath(env);
  const profiles: Record<string, ProfileConfig> = {};
  for (const entry of readdirSync(profilesPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const profilePath = join(profilesPath, entry.name);
    const manifestPath = join(profilePath, 'profile.json');
    if (!existsSync(manifestPath)) continue;

    let manifest: ProfileManifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ProfileManifest;
    } catch (error) {
      profileError(manifestPath, `cannot parse JSON: ${String(error)}`);
    }

    if (manifest.version !== 1) profileError(manifestPath, 'version must be 1');
    const id = requireString(manifest.id, 'id', manifestPath);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      profileError(manifestPath, 'id must contain lowercase letters, numbers, and hyphens');
    }
    if (id !== entry.name) {
      profileError(manifestPath, `id '${id}' must match directory '${entry.name}'`);
    }
    if (profiles[id]) profileError(manifestPath, `duplicate id '${id}'`);

    const displayName = requireString(
      manifest.displayName,
      'displayName',
      manifestPath,
    );
    const promptPath = resolveProfilePath(profilePath, manifest.systemPrompt);
    if (promptPath && !existsSync(promptPath)) {
      profileError(manifestPath, `system prompt not found: ${promptPath}`);
    }
    const skillsPath = resolveProfilePath(profilePath, manifest.skillsDirectory);
    if (skillsPath && !existsSync(skillsPath)) {
      profileError(manifestPath, `skills directory not found: ${skillsPath}`);
    }
    const mcpConfigPath = resolveProfilePath(profilePath, manifest.mcpConfig);
    if (mcpConfigPath && !existsSync(mcpConfigPath)) {
      profileError(manifestPath, `MCP config not found: ${mcpConfigPath}`);
    }

    const permissions = manifest.permissions ?? {};
    const readRoots = stringArray(
      permissions.readRoots ?? ['.'],
      'permissions.readRoots',
      manifestPath,
    );
    const writeRoots = stringArray(
      permissions.writeRoots,
      'permissions.writeRoots',
      manifestPath,
    );
    const commands = stringArray(
      permissions.operatorCommands,
      'permissions.operatorCommands',
      manifestPath,
    );
    const additionalTools = stringArray(
      permissions.additionalTools,
      'permissions.additionalTools',
      manifestPath,
    );
    const allowedTools = [
      ...(permissions.webResearch ? ['WebSearch', 'WebFetch'] : []),
      ...(skillsPath ? ['Skill'] : []),
      ...commands.map((command) => `Bash(${command}:*)`),
      ...additionalTools,
    ];
    const configuredHarness = env.BOB_AGENT_HARNESS ?? manifest.defaultHarness ?? 'pi';
    if (configuredHarness !== 'pi' && configuredHarness !== 'claude') {
      profileError(manifestPath, `unsupported default harness '${configuredHarness}'`);
    }

    profiles[id] = {
      id,
      displayName,
      description: manifest.description?.trim() || '',
      path: profilePath,
      defaultHarness: configuredHarness,
      cwd: workspace,
      systemPrompt: promptPath ? readFileSync(promptPath, 'utf8').trim() : null,
      systemPromptPath: promptPath,
      readRoots,
      allowedTools,
      writeRoots,
      timeoutMs: manifest.timeoutMs ?? 600_000,
      models: manifest.models ?? {},
      piperModelPath: resolveProfilePath(
        profilePath,
        env.BOB_PIPER_MODEL_PATH ?? manifest.voice?.piperModelPath,
      ),
      whisperPrompt: manifest.voice?.whisperPrompt ?? null,
      whisperTimeoutMs: manifest.voice?.whisperTimeoutMs ?? 600_000,
      skillsPath,
      mcpConfigPath,
      piExtensions: stringArray(
        manifest.piExtensions,
        'piExtensions',
        manifestPath,
      ).map((path) => resolveProfilePath(profilePath, path)!),
    };
  }

  if (Object.keys(profiles).length === 0) {
    throw new Error(`No Bob profiles found under ${profilesPath}`);
  }
  return profiles;
}

export const PROFILES = loadProfiles();
export const PROFILE_KEYS = Object.keys(PROFILES).sort();
export const DEFAULT_PROFILE: SessionProfile =
  process.env.BOB_DEFAULT_PROFILE ||
  (PROFILE_KEYS.includes('sample') ? 'sample' : PROFILE_KEYS[0]);

if (!(DEFAULT_PROFILE in PROFILES)) {
  throw new Error(
    `Unknown BOB_DEFAULT_PROFILE '${DEFAULT_PROFILE}'. Valid profiles: ${PROFILE_KEYS.join(', ')}`,
  );
}

export function isValidProfile(value: unknown): value is SessionProfile {
  return typeof value === 'string' && value in PROFILES;
}

export function getProfileConfig(profile: SessionProfile): ProfileConfig {
  const base = PROFILES[profile];
  if (!base) {
    throw new Error(
      `Unknown profile '${String(profile)}'. Valid profiles: ${PROFILE_KEYS.join(', ')}`,
    );
  }
  const envKey = `BOB_CLAUDE_TOOLS_${profile.toUpperCase().replace(/-/g, '_')}`;
  const override = process.env[envKey];
  if (!override) return base;
  return {
    ...base,
    allowedTools: override
      .split(',')
      .map((tool) => tool.trim())
      .filter(Boolean),
  };
}
