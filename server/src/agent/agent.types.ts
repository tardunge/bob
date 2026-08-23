import type { ProfileConfig, SessionProfile } from '../profiles';

export type AgentHarness = 'claude' | 'omp' | 'pi';

export const VALID_AGENT_HARNESSES: ReadonlySet<AgentHarness> = new Set([
  'claude',
  'omp',
  'pi',
]);

export function getDefaultAgentHarness(
  env: NodeJS.ProcessEnv = process.env,
): AgentHarness {
  const value = env.BOB_AGENT_HARNESS || 'pi';
  if (!VALID_AGENT_HARNESSES.has(value as AgentHarness)) {
    throw new Error(
      `Invalid BOB_AGENT_HARNESS '${value}'. Valid harnesses: claude, omp, pi`,
    );
  }
  return value as AgentHarness;
}

export type AgentFailureKind =
  | 'timeout'
  | 'unavailable'
  | 'invalid_request'
  | 'execution_failed'
  | 'cleanup_unverified';

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
  /** Actual current context size when the provider reports it (Pi or OMP). */
  contextTokens?: number;
}
export interface AgentRuntimeCapabilities {
  background: boolean;
  recursiveTermination: boolean;
  enforcedWriteRoots: boolean;
}

export interface ManagedProcessIdentity {
  pid: number;
  pgid: number;
  birthMarker: string;
}

export interface ManagedAgentRun {
  capabilities: AgentRuntimeCapabilities;
  processIdentity: ManagedProcessIdentity | null;
  runId: string | null;
  continuationBranch: string | null;
  activate: (() => void) | null;
  result: Promise<AgentTurnResult>;
  terminate: (() => Promise<void>) | null;
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
  readonly capabilities: AgentRuntimeCapabilities;
  run(request: AgentTurnRequest): Promise<AgentTurnResult>;
  startManaged?(request: AgentTurnRequest): Promise<ManagedAgentRun>;
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
