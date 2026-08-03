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
  audioUrlForMessage,
} from './services/api';
import { getSessionUsage } from './services/sessionApi';
import { fetchSkills, type SkillInfo } from './services/skillsApi';
import { fetchModels, type ModelOption } from './services/modelsApi';
import type { SessionUsage } from './types/session';

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
    addMessageToSession,
    setSessionStatus,
  } = useSession();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  currentSessionIdRef.current = currentSession?.id ?? null;

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

  // SSE: every voice job's lifecycle arrives here regardless of which session
  // is currently visible. We update per-session status and, if the user is
  // viewing the session that just finished, auto-play the new response.
  useSessionEvents(
    useCallback(
      (event) => {
        if (event.state === 'processing') {
          setSessionStatus(event.sessionId, {
            processing: true,
            hasError: false,
            stage: event.stage,
          });
          // Intermediate `processing` events may carry the user message once
          // whisper has finished — render it immediately so the user sees
          // their turn while the selected agent is still thinking.
          if (event.userMessage) {
            addMessageToSession(event.sessionId, event.userMessage);
          }
          return;
        }
        if (event.state === 'failed') {
          // A failure produces no reply, so it must NOT raise the green
          // "new response ready" dot (hasUnread) — that's what made a timed-out
          // turn look like a published reply that then wasn't there. Raise the
          // distinct red "turn failed" dot instead, and only when the user
          // isn't already looking at the session.
          // The failed-turn marker row (is_error) is durably persisted; append
          // it so a viewer sees the inline note now, and a later visit reloads
          // it from the DB.
          if (event.assistantMessage) {
            addMessageToSession(event.sessionId, event.assistantMessage);
          }
          setSessionStatus(event.sessionId, {
            processing: false,
            hasError: event.sessionId !== currentSessionIdRef.current,
            stage: undefined,
          });
          if (event.sessionId === currentSessionIdRef.current && event.error) {
            setError(event.error);
          }
          return;
        }
        // state === 'ready'
        const isViewing = event.sessionId === currentSessionIdRef.current;
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
          hasUnread: !isViewing,
          hasError: false,
          stage: undefined,
        });

        // Auto-play only when the user is looking at this session right now.
        if (
          isViewing &&
          event.assistantMessage &&
          event.audioFilename
        ) {
          (async () => {
            try {
              const blob = await fetchAudioBlob(
                audioUrlForMessage(event.assistantMessage!.id),
              );
              setIsPlaying(true);
              const { audio, promise } = playAudioBlob(blob);
              audioRef.current = audio;
              await promise;
            } catch (err) {
              console.warn('Auto-play failed:', err);
            } finally {
              audioRef.current = null;
              setIsPlaying(false);
            }
          })();
        }
      },
      [addMessageToSession, setSessionStatus],
    ),
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
