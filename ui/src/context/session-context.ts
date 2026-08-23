import { createContext, useContext } from 'react';
import type {
  AgentWorkRecord,
  JobStage,
  Message,
  Session,
  SessionProfile,
  SessionWithMessages,
} from '../types/session';

export interface SessionStatus {
  processing: boolean;
  hasUnread: boolean;
  hasError: boolean;
  foregroundWorkId?: string;
  stage?: JobStage;
}

export interface SessionContextValue {
  sessions: Session[];
  currentSession: SessionWithMessages | null;
  statuses: Record<string, SessionStatus>;
  isLoading: boolean;
  error: string | null;
  createSession: (
    title?: string,
    profile?: SessionProfile,
  ) => Promise<Session>;
  selectSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  updateSessionTitle: (id: string, title: string) => Promise<void>;
  addMessageToSession: (sessionId: string, message: Message) => void;
  upsertAgentWork: (sessionId: string, work: AgentWorkRecord) => void;
  setSessionStatus: (
    sessionId: string,
    patch: Partial<SessionStatus>,
  ) => void;
  refreshSessions: () => Promise<void>;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
