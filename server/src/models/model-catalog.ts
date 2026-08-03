import type { AgentHarness } from '../agent/agent.types';
import { VALID_MODELS } from '../claude/claude-command';

export interface ModelOption {
  id: string;
  label: string;
}

const DEFAULT_PI_MODEL_IDS = [
  'gpt-5.6-luna',
  'gpt-5.3-codex-spark',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.5',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
] as const;

const PI_MODEL_LABELS: Record<string, string> = {
  'gpt-5.6-luna': 'GPT-5.6 Luna',
  'gpt-5.3-codex-spark': 'GPT-5.3 Codex Spark',
  'gpt-5.4': 'GPT-5.4',
  'gpt-5.4-mini': 'GPT-5.4 Mini',
  'gpt-5.5': 'GPT-5.5',
  'gpt-5.6-sol': 'GPT-5.6 Sol',
  'gpt-5.6-terra': 'GPT-5.6 Terra',
};

function piModelLabel(modelId: string, provider: string): string {
  const label = PI_MODEL_LABELS[modelId] ?? modelId;
  return provider === 'openai-codex' ? label : `${label} (${provider})`;
}

const DEFAULT_PI_MODELS: readonly ModelOption[] = DEFAULT_PI_MODEL_IDS.map(
  (id) => ({ id: `openai-codex/${id}`, label: piModelLabel(id, 'openai-codex') }),
);

const CLAUDE_LABELS: Record<string, string> = {
  'claude-opus-4-8': 'Opus 4.8',
  'claude-sonnet-5': 'Sonnet 5',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
  'claude-fable-5': 'Fable 5',
};

export function getModelOptions(
  harness: AgentHarness,
  env: NodeJS.ProcessEnv = process.env,
): ModelOption[] {
  if (harness === 'claude') {
    return [...VALID_MODELS].map((id) => ({
      id,
      label: CLAUDE_LABELS[id] ?? id,
    }));
  }

  // Pi owns its provider catalog. Qualifying the defaults is important: Pi's
  // bare gpt ids can resolve to a different provider (for example Azure),
  // which then uses the wrong credential store.
  const configured = env.BOB_PI_MODELS || env.PI_MODELS;
  if (!configured) return [...DEFAULT_PI_MODELS];
  return configured
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => {
      const [provider, ...rest] = id.split('/');
      const qualifiedId = rest.length > 0 ? id : `openai-codex/${id}`;
      const modelId = rest.length > 0 ? rest.join('/') : id;
      return {
        id: qualifiedId,
        label: piModelLabel(
          modelId,
          rest.length > 0 ? provider : 'openai-codex',
        ),
      };
    });
}

export function isValidModelForHarness(
  harness: AgentHarness,
  model: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (harness === 'claude') return VALID_MODELS.has(model);
  const configured = getModelOptions(harness, env).map((option) => option.id);
  if (!/^[A-Za-z0-9._:/-]+$/.test(model)) return false;
  return configured.length === 0 || configured.includes(model);
}
