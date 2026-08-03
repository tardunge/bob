import { isAbsolute, resolve } from 'path';
import type { ProfileConfig } from '../profiles';
import type { ProcessInvocation } from '../process/process-runner';

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const VALID_EFFORT_LEVELS: ReadonlySet<EffortLevel> = new Set([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

export const VALID_MODELS: ReadonlySet<string> = new Set([
  'claude-opus-4-8',
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
  'claude-fable-5',
]);

export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'claude-opus-4-8': 1_000_000,
  'claude-haiku-4-5-20251001': 200_000,
};

export interface BuildClaudeCommandOptions {
  userMessage: string;
  config: ProfileConfig;
  mcpConfigPath?: string | null;
  claudeSessionId?: string | null;
  effort?: EffortLevel | null;
  model?: string | null;
  claudePath?: string;
}

export function buildPermissionSettings(
  cwd: string,
  readRoots: string[],
  allowedTools: string[],
  writeRoots: string[],
): string {
  const readPermissions = readRoots
    .map((root) => (isAbsolute(root) ? root : resolve(cwd, root)))
    .flatMap((root) => [
    `Read(${root}/**)`,
    `Grep(${root}/**)`,
    `Glob(${root}/**)`,
  ]);
  const writePermissions = writeRoots
    .map((root) => (isAbsolute(root) ? root : resolve(cwd, root)))
    .flatMap((root) => [
    `Edit(${root}/**)`,
    `Write(${root}/**)`,
  ]);
  return JSON.stringify({
    permissions: {
      defaultMode: 'dontAsk',
      allow: [...readPermissions, ...writePermissions, ...allowedTools],
    },
  });
}

// Pure argv builder. Values remain separate arguments all the way to spawn;
// no shell quoting or shell interpretation is involved.
export function buildClaudeInvocation(
  opts: BuildClaudeCommandOptions,
): ProcessInvocation {
  const {
    userMessage,
    config,
    mcpConfigPath,
    claudeSessionId,
    effort,
    model,
    claudePath,
  } = opts;

  if (effort != null && !VALID_EFFORT_LEVELS.has(effort)) {
    throw new Error(`Invalid effort level: ${String(effort)}`);
  }
  if (model != null && !VALID_MODELS.has(model)) {
    throw new Error(`Invalid model: ${String(model)}`);
  }

  const args = ['-p', '--output-format', 'json'];
  if (!claudeSessionId && config.systemPrompt) {
    args.push('--system-prompt', config.systemPrompt);
  }
  args.push(
    '--settings',
    buildPermissionSettings(
      config.cwd,
      config.readRoots,
      config.allowedTools,
      config.writeRoots,
    ),
    '--permission-mode',
    'dontAsk',
  );
  if (claudeSessionId) args.push('--resume', claudeSessionId);
  const modelName = model ?? config.models.claude;
  if (modelName) args.push('--model', modelName);
  if (effort) args.push('--effort', effort);
  if (mcpConfigPath) args.push('--mcp-config', mcpConfigPath);
  args.push('--', userMessage);

  return { command: claudePath || 'claude', args };
}

// Kept as a compatibility name for callers that used the old pure builder.
// It now returns a structured invocation rather than a shell command string.
export const buildClaudeCommand = buildClaudeInvocation;
