import { useState, useCallback, useRef, useEffect } from 'react';
import { VoiceButton } from './components/VoiceButton';
import { Sidebar } from './components/Sidebar';
import { Conversation } from './components/Conversation';
import { SessionUsageChip } from './components/SessionUsageChip';
import { SessionProvider } from './context/SessionContext';
import { useSession } from './context/session-context';
import { useAudioRecorder } from './hooks/useAudioRecorder';
import { useSessionEvents } from './hooks/useSessionEvents';
import {
  sendVoiceMessage,
  fetchAudioBlob,
  playAudioBlob,
  audioUrlForFilename,
} from './services/api';
import { getSessionUsage } from './services/sessionApi';
import { fetchSkills, type SkillInfo } from './services/skillsApi';
import { fetchModels, type ModelOption } from './services/modelsApi';
import type { AgentWorkRecord, SessionUsage } from './types/session';
import { browserAttention } from './services/attention';
import { bobChime } from './services/bobChime';
import {
  getTerminalAgentWorkAfter,
  getTerminalSequence,
} from './services/agentWorkApi';

function MainContent() {
  const {
    isRecording,
    startRecording,
    stopRecording,
    error: recorderError,
  } = useAudioRecorder();
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    currentSession,
    statuses,
    createSession,
    selectSession,
    refreshSessions,
    addMessageToSession,
    setSessionStatus,
    upsertAgentWork,
  } = useSession();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const terminalReconcileRef = useRef<Promise<void> | null>(null);
  const visualTerminalCursorRef = useRef<number | null>(null);
  const terminalReservationsRef = useRef(
    new Map<
      string,
      {
        sequence: number;
        work: AgentWorkRecord;
        decision: 'pending' | 'full' | 'chime';
      }
    >(),
  );
  currentSessionIdRef.current = currentSession?.id ?? null;

  useEffect(() => {
    browserAttention.setSelectedConversation(currentSession?.id ?? null);
  }, [currentSession?.id]);

  useEffect(() => {
    browserAttention.setRecording(isRecording);
  }, [isRecording]);

  const [usageBySession, setUsageBySession] = useState<
    Record<string, SessionUsage>
  >({});

  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [skillBySession, setSkillBySession] = useState<Record<string, string>>({});
  const [effortBySession, setEffortBySession] = useState<Record<string, string>>({});
  const [modelBySession, setModelBySession] = useState<Record<string, string>>({});

  const sessionKey = currentSession?.id ?? '__none__';
  const selectedSkill = skillBySession[sessionKey] ?? '';
  const selectedEffort = effortBySession[sessionKey] ?? '';
  const selectedModel = modelBySession[sessionKey] ?? '';
  const setSelectedSkill = useCallback(
    (value: string) =>
      setSkillBySession((prev) => ({ ...prev, [sessionKey]: value })),
    [sessionKey],
  );
  const setSelectedEffort = useCallback(
    (value: string) =>
      setEffortBySession((prev) => ({ ...prev, [sessionKey]: value })),
    [sessionKey],
  );
  const setSelectedModel = useCallback(
    (value: string) =>
      setModelBySession((prev) => ({ ...prev, [sessionKey]: value })),
    [sessionKey],
  );

  const profile = currentSession?.profile;
  // With no session yet, omit the harness so the server applies the configured
  // profile default.
  const harness = currentSession?.agent_harness;
  // Bob's 600s timeout safely covers the full effort range.
  const effortOptions = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
  const currentStatus = currentSession ? statuses[currentSession.id] : undefined;
  const isProcessing = currentStatus?.processing === true;
  const processingStage = currentStatus?.stage;

  // Seed the usage chip when switching into a session, so it reflects state
  // from prior turns before the next SSE event lands.
  useEffect(() => {
    const id = currentSession?.id;
    if (!id) return;
    if (usageBySession[id]) return;
    let cancelled = false;
    getSessionUsage(id)
      .then((u) => {
        if (!cancelled) setUsageBySession((prev) => ({ ...prev, [id]: u }));
      })
      .catch((err) => {
        console.warn('Failed to fetch session usage:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [currentSession?.id, usageBySession]);

  // Fetch skills for the active profile. The picker renders whenever the
  // resulting list is non-empty, regardless of profile — keeps adding new
  // profiles free.
  useEffect(() => {
    let cancelled = false;
    fetchSkills(profile)
      .then((list) => {
        if (!cancelled) setSkills(list);
      })
      .catch((err) => {
        console.warn('Failed to fetch skills:', err);
        if (!cancelled) setSkills([]);
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  useEffect(() => {
    let cancelled = false;
    fetchModels(harness)
      .then((list) => {
        if (!cancelled) setModelOptions(list);
      })
      .catch((err) => {
        console.warn('Failed to fetch models:', err);
        if (!cancelled) setModelOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [harness]);

  const deliverTerminalAudio = useCallback(
    (
      sessionId: string,
      work: AgentWorkRecord,
      audioFilename: string | null | undefined,
    ) => {
      if (bobChime.wasConsumed(work)) return;
      const notify = (decision: 'pending' | 'full' | 'chime') => {
        if (work.terminal_sequence !== null) {
          terminalReservationsRef.current.set(work.id, {
            sequence: work.terminal_sequence,
            work,
            decision,
          });
        }
        bobChime.notifyTerminal(work, decision);
      };
      const initiallyAttending =
        bobChime.automaticDeliveryEnabled() &&
        browserAttention.stateFor(sessionId) === 'attending' &&
        browserAttention.isAudioIdle();
      if (
        work.state !== 'succeeded' ||
        !audioFilename ||
        !initiallyAttending
      ) {
        notify('chime');
        return;
      }
      notify('pending');
      void (async () => {
        try {
          const blob = await fetchAudioBlob(audioUrlForFilename(audioFilename));
          const stillAttending =
            !bobChime.wasConsumed(work) &&
            browserAttention.stateFor(sessionId) === 'attending' &&
            browserAttention.isAudioIdle();
          if (!stillAttending) {
            notify('chime');
            return;
          }
          setIsPlaying(true);
          const { audio, promise } = playAudioBlob(blob);
          audioRef.current = audio;
          notify('full');
          await promise;
        } catch (error) {
          console.warn('Auto-play failed:', error);
          notify('chime');
        } finally {
          audioRef.current = null;
          setIsPlaying(false);
        }
      })();
    },
    [],
  );

  const reconcileTerminalIndicators = useCallback(async () => {
    if (terminalReconcileRef.current) return terminalReconcileRef.current;
    const reconciliation = (async () => {
      const automaticDelivery = bobChime.automaticDeliveryEnabled();
      let cursor = automaticDelivery
        ? bobChime.terminalCursor()
        : visualTerminalCursorRef.current;
      if (cursor === null) {
        if (!automaticDelivery) {
          visualTerminalCursorRef.current = await getTerminalSequence();
        }
        return;
      }
      const audioCursor = bobChime.terminalCursor();
      if (audioCursor !== null) {
        for (const [workId, reservation] of terminalReservationsRef.current) {
          if (reservation.sequence <= audioCursor) {
            terminalReservationsRef.current.delete(workId);
          }
        }
      }
      while (true) {
        const works = await getTerminalAgentWorkAfter(cursor);
        if (works.length === 0) return;
        for (const work of works) {
          if (work.state === 'succeeded' && work.stage === 'piper') return;
          if (work.terminal_sequence !== null) {
            visualTerminalCursorRef.current = Math.max(
              visualTerminalCursorRef.current ?? work.terminal_sequence,
              work.terminal_sequence,
            );
            if (!automaticDelivery) cursor = visualTerminalCursorRef.current;
          }
          const failed = work.state !== 'succeeded';
          const attending =
            browserAttention.stateFor(work.session_id) === 'attending';
          setSessionStatus(work.session_id, {
            hasUnread: !failed && !attending,
            hasError: failed && !attending,
          });
          upsertAgentWork(work.session_id, work);
          if (!automaticDelivery || bobChime.wasConsumed(work)) continue;
          if (
            work.terminal_sequence === null ||
            terminalReservationsRef.current.has(work.id)
          ) {
            return;
          }
          terminalReservationsRef.current.set(work.id, {
            sequence: work.terminal_sequence,
            work,
            decision: 'pending',
          });
          deliverTerminalAudio(work.session_id, work, work.audio_filename);
          return;
        }
        if (automaticDelivery || works.length < 100) return;
      }
    })();
    terminalReconcileRef.current = reconciliation;
    try {
      await reconciliation;
    } finally {
      if (terminalReconcileRef.current === reconciliation) {
        terminalReconcileRef.current = null;
      }
    }
  }, [deliverTerminalAudio, setSessionStatus, upsertAgentWork]);
  useEffect(() => {
    const reconcile = () => void reconcileTerminalIndicators();
    window.addEventListener('bob-chime-reconcile', reconcile);
    return () => window.removeEventListener('bob-chime-reconcile', reconcile);
  }, [reconcileTerminalIndicators]);
  useEffect(() => {
    const handoff = () => {
      for (const reservation of terminalReservationsRef.current.values()) {
        bobChime.notifyTerminal(reservation.work, reservation.decision);
      }
      void reconcileTerminalIndicators();
    };
    window.addEventListener('bob-chime-owner-acquired', handoff);
    return () => window.removeEventListener('bob-chime-owner-acquired', handoff);
  }, [reconcileTerminalIndicators]);


  useSessionEvents(
    useCallback(
      (event) => {
        const isViewing = event.sessionId === currentSessionIdRef.current;
        const isAttending =
          browserAttention.stateFor(event.sessionId) === 'attending';

        if (event.kind === 'agent_work') {
          upsertAgentWork(event.sessionId, event.agentWork);
          if (event.action === 'promoted') {
            setSessionStatus(event.sessionId, {
              processing: false,
              foregroundWorkId: undefined,
              stage: undefined,
            });
            return;
          }
          if (event.action === 'orphaned') {
            setSessionStatus(event.sessionId, {
              processing: true,
              foregroundWorkId: event.agentWork.id,
              stage: event.agentWork.stage ?? undefined,
              hasError: true,
            });
            if (isViewing && event.error) setError(event.error);
            return;
          }
          if (event.assistantMessage) {
            addMessageToSession(event.sessionId, event.assistantMessage);
          }
          const failed = event.agentWork.state !== 'succeeded';
          setSessionStatus(event.sessionId, {
            ...(event.agentWork.promoted_at === null
              ? {
                  processing: false,
                  foregroundWorkId: undefined,
                  stage: undefined,
                }
              : {}),
            hasUnread: !failed && !isAttending,
            hasError: failed && !isAttending,
          });
          if (isViewing && event.error) setError(event.error);
          window.dispatchEvent(new Event('bob-chime-reconcile'));
          return;
        }

        if (event.agentWork) {
          upsertAgentWork(event.sessionId, event.agentWork);
        }
        if (event.state === 'processing') {
          setSessionStatus(event.sessionId, {
            processing: true,
            hasError: false,
            foregroundWorkId: event.agentWork?.id,
            stage: event.stage,
          });
          if (event.userMessage) {
            addMessageToSession(event.sessionId, event.userMessage);
          }
          return;
        }
        if (event.state === 'failed') {
          if (event.assistantMessage) {
            addMessageToSession(event.sessionId, event.assistantMessage);
          }
          setSessionStatus(event.sessionId, {
            processing: false,
            foregroundWorkId: undefined,
            hasError: !isAttending,
            stage: undefined,
          });
          if (isViewing && event.error) setError(event.error);
          if (event.agentWork) bobChime.notifyTerminal(event.agentWork, 'chime');
          return;
        }

        if (event.userMessage) {
          addMessageToSession(event.sessionId, event.userMessage);
        }
        if (event.assistantMessage) {
          addMessageToSession(event.sessionId, event.assistantMessage);
        }
        if (event.usage) {
          const usage = event.usage;
          setUsageBySession((prev) => ({ ...prev, [event.sessionId]: usage }));
        }
        setSessionStatus(event.sessionId, {
          processing: false,
          foregroundWorkId: undefined,
          hasUnread: !isAttending,
          hasError: false,
          stage: undefined,
        });

        if (!event.agentWork) return;
        window.dispatchEvent(new Event('bob-chime-reconcile'));
      },
      [
        addMessageToSession,
        setSessionStatus,
        upsertAgentWork,
      ],
    ),
    useCallback(() => {
      void refreshSessions();
      const selectedSessionId = currentSessionIdRef.current;
      if (selectedSessionId) void selectSession(selectedSessionId);
      void reconcileTerminalIndicators();
      bobChime.reconnect();
    }, [reconcileTerminalIndicators, refreshSessions, selectSession]),
  );

  const handleStopPlaying = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  }, []);

  const handleVoiceButtonClick = useCallback(async () => {
    if (isRecording) {
      const audioBlob = await stopRecording();
      if (!audioBlob) return;

      setError(null);

      try {
        let sessionId = currentSession?.id;
        let harness = currentSession?.agent_harness ?? 'pi';
        if (!sessionId) {
          const newSession = await createSession();
          sessionId = newSession.id;
          harness = newSession.agent_harness;
        }

        // Optimistically mark processing — the SSE `processing` event will
        // confirm this, but the user gets instant feedback.
        setSessionStatus(sessionId, { processing: true });

        await sendVoiceMessage(
          audioBlob,
          sessionId,
          harness,
          selectedSkill || undefined,
          selectedEffort || undefined,
          selectedModel || undefined,
        );
        // Nothing else to do here — completion lands via SSE.
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'An error occurred';
        setError(message);
        console.error('Error submitting voice:', err);
        if (currentSessionIdRef.current) {
          setSessionStatus(currentSessionIdRef.current, { processing: false });
        }
      }
    } else {
      setError(null);
      await bobChime.unlockAudio().catch((error) => {
        console.warn('Bob Chime audio unlock failed:', error);
      });
      await startRecording();
    }
  }, [
    isRecording,
    startRecording,
    stopRecording,
    currentSession,
    createSession,
    selectedSkill,
    selectedEffort,
    selectedModel,
    setSessionStatus,
  ]);

  const displayError = error || recorderError;

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-gradient-to-br from-slate-900 to-slate-800">
      <div className="flex-shrink-0 p-4 border-b border-slate-700 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-white truncate">
            {currentSession?.title || 'Bob'}
          </h1>
          {!currentSession && (
            <p className="text-slate-400 text-sm">
              Your personal voice assistant
            </p>
          )}
        </div>
        {currentSession && (
          <SessionUsageChip
            usage={usageBySession[currentSession.id] ?? null}
          />
        )}
      </div>

      <Conversation />

      <div className="flex-shrink-0 p-6 border-t border-slate-700 flex flex-col items-center gap-4">
        <div className="w-full grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div aria-hidden />
          <VoiceButton
            isRecording={isRecording}
            isProcessing={isProcessing}
            isPlaying={isPlaying}
            processingStage={processingStage}
            onClick={handleVoiceButtonClick}
            onStop={handleStopPlaying}
          />
          <div className="justify-self-end grid grid-cols-[auto_minmax(8rem,14rem)] items-center gap-x-2 gap-y-2">
            <label
              htmlFor="model-select"
              className="text-slate-400 text-xs uppercase tracking-wide text-right"
            >
              Model
            </label>
            <select
              id="model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={isRecording || isProcessing}
              className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 disabled:opacity-50"
              title={
                selectedModel
                  ? `Pass --model ${selectedModel} to ${harness ?? 'selected harness'}`
                  : `Default — ${harness ?? 'configured'} profile model`
              }
            >
              <option value="">Default (profile model)</option>
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <label
              htmlFor="effort-select"
              className="text-slate-400 text-xs uppercase tracking-wide text-right"
            >
              Effort
            </label>
            <select
              id="effort-select"
              value={selectedEffort}
              onChange={(e) => setSelectedEffort(e.target.value)}
              disabled={isRecording || isProcessing}
              className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:opacity-50"
              title={
                selectedEffort
                  ? `Pass effort ${selectedEffort} to the selected agent`
                  : 'Auto — agent default'
              }
            >
              <option value="">Auto</option>
              {effortOptions.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
            {skills.length > 0 && (
              <>
                <label
                  htmlFor="skill-select"
                  className="text-slate-400 text-xs uppercase tracking-wide text-right"
                >
                  Skill
                </label>
                <select
                  id="skill-select"
                  value={selectedSkill}
                  onChange={(e) => setSelectedSkill(e.target.value)}
                  disabled={isRecording || isProcessing}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-sm rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-amber-500/50 disabled:opacity-50"
                  title={
                    selectedSkill
                      ? skills.find((s) => s.name === selectedSkill)?.description
                      : 'Auto — no skill forced; first-turn only'
                  }
                >
                  <option value="">Auto</option>
                  {skills.map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        </div>

        {displayError && (
          <div className="mt-4 px-4 py-2 bg-red-500/20 border border-red-500/50 rounded-lg">
            <p className="text-red-300 text-sm">{displayError}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function App() {
  return (
    <SessionProvider>
      <div className="h-screen flex">
        <Sidebar />
        <MainContent />
      </div>
    </SessionProvider>
  );
}

export default App;
