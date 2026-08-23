export type SessionProfile = string;
export type AgentHarness = 'claude' | 'omp' | 'pi';

export interface Session {
  id: string;
  // Legacy compatibility field; new code uses the harness-neutral fields.
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
  // 1 when this row is a failed-turn marker (rendered as an inline failure
  // note, not a normal assistant bubble); 0/undefined otherwise.
  is_error?: number;
}

export interface SessionWithMessages extends Session {
  messages: Message[];
  active_turn: TurnRecord | null;
  agent_work: AgentWorkRecord[];
}

// POST /api/voice now returns immediately; actual work runs in the background
// and the client listens for completion via SSE.
export interface VoiceAccepted {
  sessionId: string;
  jobId: string;
  harness: AgentHarness;
  accepted: true;
}

export type JobState = 'processing' | 'ready' | 'failed';

export type JobStage = 'whisper' | 'agent' | 'piper';
export type TurnState = 'processing' | 'completed' | 'failed';

export interface TurnRecord {
  id: string;
  session_id: string;
  harness: AgentHarness;
  state: TurnState;
  stage: JobStage | null;
  error: string | null;
  created_at: string;
  updated_at: string;
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

export interface AgentWorkRecord {
  id: string;
  turn_id: string;
  session_id: string;
  harness: AgentHarness;
  state: AgentWorkState;
  stage: JobStage | null;
  background_supported: number;
  base_revision: number;
  profile_timeout_ms: number;
  profile_deadline_at_ms: number;
  promotion_due_at_ms: number | null;
  adapter_run_id: string | null;
  continuation_branch: string | null;
  summary: string | null;
  audio_filename: string | null;
  promoted_at: string | null;
  completed_at: string | null;
  error: string | null;
  run_pid: number | null;
  run_pgid: number | null;
  process_birth_marker: string | null;
  speech_suppressed: number;
  write_roots_json: string;
  write_roots: string[];
  read_only_reason: string | null;
  terminal_sequence: number | null;
  message_id: number | null;
  cancellable: boolean;
  created_at: string;
  updated_at: string;
}

export interface TurnSessionEvent {
  kind: 'turn';
  sessionId: string;
  harness: AgentHarness;
  jobId?: string;
  state: JobState;
  stage?: JobStage;
  userMessage?: Message;
  assistantMessage?: Message;
  audioFilename?: string | null;
  usage?: SessionUsage;
  error?: string;
  agentWork?: AgentWorkRecord;
  speechSuppressed?: boolean;
}

export interface AgentWorkSessionEvent {
  kind: 'agent_work';
  sessionId: string;
  harness: AgentHarness;
  agentWork: AgentWorkRecord;
  action: 'promoted' | 'terminal' | 'orphaned';
  assistantMessage?: Message;
  audioFilename?: string | null;
  speechSuppressed?: boolean;
  error?: string;
}

export type SessionEvent = TurnSessionEvent | AgentWorkSessionEvent;
