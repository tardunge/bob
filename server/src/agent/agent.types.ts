import type { ProfileConfig, SessionProfile } from '../profiles';

export type AgentHarness = 'claude' | 'pi';

export const VALID_AGENT_HARNESSES: ReadonlySet<AgentHarness> = new Set([
  'claude',
  'pi',
]);

export function getDefaultAgentHarness(
  env: NodeJS.ProcessEnv = process.env,
): AgentHarness {
  const value = env.BOB_AGENT_HARNESS || 'pi';
  if (!VALID_AGENT_HARNESSES.has(value as AgentHarness)) {
    throw new Error(
      `Invalid BOB_AGENT_HARNESS '${value}'. Valid harnesses: claude, pi`,
    );
  }
  return value as AgentHarness;
}

export type AgentFailureKind =
  | 'timeout'
  | 'unavailable'
  | 'invalid_request'
  | 'execution_failed';

export interface AgentContinuation {
  harness: AgentHarness;
  sessionId: string;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  contextWindow: number;
  /** Actual current context size when the provider reports it (Pi). */
  contextTokens?: number;
}

export interface AgentTurnRequest {
  userMessage: string;
  harness: AgentHarness;
  profile: SessionProfile;
  config: ProfileConfig;
  mcpConfigPath?: string | null;
  continuation?: AgentContinuation | null;
  effort?: string | null;
  model?: string | null;
}

export interface AgentTurnResult {
  displayText: string;
  speechText: string;
  continuation: AgentContinuation | null;
  usage: AgentUsage | null;
}

export interface AgentRuntime {
  readonly harness: AgentHarness;
  run(request: AgentTurnRequest): Promise<AgentTurnResult>;
}

export class AgentRuntimeError extends Error {
  constructor(
    public readonly kind: AgentFailureKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AgentRuntimeError';
  }
}
