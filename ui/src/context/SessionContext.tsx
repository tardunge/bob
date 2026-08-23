import {
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import type {
  Session,
  AgentWorkRecord,
  SessionProfile,
  SessionWithMessages,
  Message,
} from '../types/session';
import {
  SessionContext,
  type SessionStatus,
} from './session-context';
import * as sessionApi from '../services/sessionApi';


export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] =
    useState<SessionWithMessages | null>(null);
  const [statuses, setStatuses] = useState<Record<string, SessionStatus>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSessions = useCallback(async () => {
    try {
      const fetchedSessions = await sessionApi.getSessions();
      setSessions(fetchedSessions);
    } catch (err) {
      console.error('Failed to fetch sessions:', err);
      setError('Failed to load sessions');
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      setIsLoading(true);
      await refreshSessions();
      setIsLoading(false);
    };
    init();
  }, [refreshSessions]);

  const createSession = useCallback(
    async (title?: string, profile?: SessionProfile) => {
      const session = await sessionApi.createSession(title, profile);
      await refreshSessions();
      const sessionWithMessages = await sessionApi.getSession(session.id);
      setCurrentSession(sessionWithMessages);
      return session;
    },
    [refreshSessions],
  );

  const selectSession = useCallback(async (id: string) => {
    try {
      setError(null);
      const session = await sessionApi.getSession(id);
      setCurrentSession(session);
      const foreground = session.agent_work.find(
        (work) =>
          work.state === 'foreground' ||
          work.state === 'orphaned' ||
          (work.state === 'settling' && work.promoted_at === null) ||
          (work.state === 'succeeded' &&
            work.stage === 'piper' &&
            work.promoted_at === null),
      );
      const hasFailure = session.agent_work.some((work) =>
        ['failed', 'timed_out', 'cancelled', 'interrupted', 'orphaned'].includes(
          work.state,
        ),
      );
      setStatuses((prev) => {
        const cur = prev[id] ?? {
          processing: false,
          hasUnread: false,
          hasError: false,
        };
        return {
          ...prev,
          [id]: {
            ...cur,
            processing: Boolean(foreground),
            foregroundWorkId: foreground?.id,
            hasUnread: false,
            stage: foreground?.stage ?? undefined,
            hasError: cur.hasError || hasFailure,
          },
        };
      });
    } catch (err) {
      console.error('Failed to select session:', err);
      setError('Failed to load session');
    }
  }, []);

  const deleteSession = useCallback(
    async (id: string) => {
      await sessionApi.deleteSession(id);
      if (currentSession?.id === id) {
        setCurrentSession(null);
      }
      setStatuses((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await refreshSessions();
    },
    [currentSession, refreshSessions],
  );

  const updateSessionTitle = useCallback(
    async (id: string, title: string) => {
      await sessionApi.updateSession(id, { title });
      await refreshSessions();
      if (currentSession?.id === id) {
        setCurrentSession((prev) => (prev ? { ...prev, title } : null));
      }
    },
    [currentSession, refreshSessions],
  );

  // Append a message to ANY session (used by the SSE handler — events may
  // arrive for inactive sessions). If the target is the currently loaded
  // session, we mutate its in-memory message list so the Conversation view
  // updates immediately without a refetch.
  const addMessageToSession = useCallback(
    (sessionId: string, message: Message) => {
      setCurrentSession((prev) => {
        if (!prev || prev.id !== sessionId) return prev;
        // Avoid duplicate appends if the same event fires twice.
        if (prev.messages.some((m) => m.id === message.id)) return prev;
        return { ...prev, messages: [...prev.messages, message] };
      });
    },
    [],
  );

  const upsertAgentWork = useCallback(
    (sessionId: string, work: AgentWorkRecord) => {
      setCurrentSession((prev) => {
        if (!prev || prev.id !== sessionId) return prev;
        const withoutWork = prev.agent_work.filter((item) => item.id !== work.id);
        return { ...prev, agent_work: [work, ...withoutWork].slice(0, 20) };
      });
    },
    [],
  );

  const setSessionStatus = useCallback(
    (sessionId: string, patch: Partial<SessionStatus>) => {
      setStatuses((prev) => {
        const cur = prev[sessionId] ?? {
          processing: false,
          hasUnread: false,
          hasError: false,
        };
        return { ...prev, [sessionId]: { ...cur, ...patch } };
      });
    },
    [],
  );

  return (
    <SessionContext.Provider
      value={{
        sessions,
        currentSession,
        statuses,
        isLoading,
        error,
        createSession,
        selectSession,
        deleteSession,
        updateSessionTitle,
        addMessageToSession,
        setSessionStatus,
        upsertAgentWork,
        refreshSessions,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

