import type { AgentHarness, ManagedProcessIdentity } from '../agent/agent.types';
import type { Message } from '../session/session.dto';

export type AgentWorkState =
  | 'foreground'
  | 'settling'
  | 'background'
  | 'orphaned'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
  | 'interrupted';

export type AgentWorkStage = 'whisper' | 'agent' | 'piper' | null;

export interface AgentWorkRecord {
  id: string;
  turn_id: string;
  session_id: string;
  harness: AgentHarness;
  state: AgentWorkState;
  stage: AgentWorkStage;
  background_supported: number;
  base_revision: number;
  profile_timeout_ms: number;
  profile_deadline_at_ms: number;
  promotion_due_at_ms: number | null;
  promoted_at: string | null;
  completed_at: string | null;
  error: string | null;
  adapter_run_id: string | null;
  continuation_branch: string | null;
  summary: string | null;
  audio_filename: string | null;
  run_pid: number | null;
  run_pgid: number | null;
  process_birth_marker: string | null;
  write_roots_json: string;
  read_only_reason: string | null;
  terminal_sequence: number | null;
  message_id: number | null;
  speech_suppressed: number;
  created_at: string;
  updated_at: string;
}

export interface BackgroundCallbackRecord {
  id: string;
  agent_work_id: string;
  session_id: string;
  terminal_sequence: number;
  outcome: Exclude<
    AgentWorkState,
    'foreground' | 'settling' | 'background' | 'orphaned'
  >;
  content: string;
  message_id: number;
  delivery_state: 'pending' | 'claimed' | 'acknowledged';
  claim_turn_id: string | null;
  created_at: string;
  acknowledged_at: string | null;
}

export interface AgentWorkProjection extends AgentWorkRecord {
  write_roots: string[];
  cancellable: boolean;
}

export interface AgentWorkEvent {
  kind: 'agent_work';
  sessionId: string;
  harness: AgentHarness;
  agentWork: AgentWorkProjection;
  action: 'promoted' | 'terminal' | 'orphaned';
  assistantMessage?: Message;
  audioFilename?: string | null;
  speechSuppressed?: boolean;
  error?: string;
}

export interface AgentWorkAdmission {
  turnId: string;
  work: AgentWorkRecord;
}

export interface PreparedAgentWork {
  work: AgentWorkRecord;
  prompt: string;
  continuation: { harness: AgentHarness; sessionId: string } | null;
}

export interface AttachedRun {
  identity: ManagedProcessIdentity | null;
}

const TERMINAL_AGENT_WORK_STATE: Record<AgentWorkState, boolean> = {
  foreground: false,
  settling: false,
  background: false,
  orphaned: false,
  succeeded: true,
  failed: true,
  timed_out: true,
  cancelled: true,
  interrupted: true,
};

export function isTerminalAgentWorkState(state: AgentWorkState): boolean {
  return TERMINAL_AGENT_WORK_STATE[state];
}
