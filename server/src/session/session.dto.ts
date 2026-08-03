export { type SessionProfile } from '../profiles';
import type { AgentHarness } from '../agent/agent.types';
import type { TurnRecord } from '../turn/turn-store';
import type { SessionProfile } from '../profiles';

export interface Session {
  id: string;
  // Legacy field retained for database compatibility; new code uses the
  // harness-neutral continuation fields below.
  claude_session_id: string | null;
  agent_harness: AgentHarness;
  agent_session_id: string | null;
  title: string;
  profile: SessionProfile;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  is_error?: number;
  usage_input_tokens?: number | null;
  usage_output_tokens?: number | null;
  usage_cache_read_tokens?: number | null;
  usage_cache_creation_tokens?: number | null;
  usage_cost_usd?: number | null;
  usage_context_window?: number | null;
  usage_context_tokens?: number | null;
}

export interface SessionUsage {
  cumulative: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    costUsd: number;
  };
  latest: {
    inputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    contextWindow: number;
    contextTokens?: number | null;
  } | null;
}

export interface SessionWithMessages extends Session {
  messages: Message[];
  // Latest durable turn record, allowing clients to recover lifecycle state
  // after an SSE reconnect or server restart.
  active_turn: TurnRecord | null;
}

export interface CreateSessionDto {
  title?: string;
  profile?: SessionProfile;
  agent_harness?: AgentHarness;
}

export interface UpdateSessionDto {
  title?: string;
  claude_session_id?: string;
  agent_harness?: AgentHarness;
  agent_session_id?: string | null;
}
