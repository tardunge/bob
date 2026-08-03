export type SessionProfile = string;
export type AgentHarness = 'claude' | 'pi';

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

export interface SessionEvent {
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
}
