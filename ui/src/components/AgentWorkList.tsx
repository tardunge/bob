import { useEffect, useMemo, useState } from 'react';
import { useSession } from '../context/session-context';
import { cancelAgentWork } from '../services/agentWorkApi';
import type { AgentWorkRecord, AgentWorkState } from '../types/session';
import { parseServerTimestamp } from '../utils/time';

const STATE_LABEL: Record<AgentWorkState, string> = {
  foreground: 'Foreground',
  settling: 'Finishing',
  background: 'Background',
  orphaned: 'Termination unverified',
  succeeded: 'Completed',
  failed: 'Failed',
  timed_out: 'Timed out',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
};

const TERMINAL_STATE: Record<AgentWorkState, boolean> = {
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

function elapsedLabel(work: AgentWorkRecord, now: number): string {
  const start = parseServerTimestamp(work.created_at).getTime();
  const end = work.completed_at
    ? parseServerTimestamp(work.completed_at).getTime()
    : now;
  const seconds = Math.max(0, Math.floor((end - start) / 1_000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

function AgentWorkCard({
  work,
  now,
  onUpdated,
}: {
  work: AgentWorkRecord;
  now: number;
  onUpdated: (work: AgentWorkRecord) => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const failed = ['failed', 'timed_out', 'interrupted', 'orphaned'].includes(
    work.state,
  );

  const cancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      onUpdated(await cancelAgentWork(work.id));
    } catch (error) {
      setCancelError(error instanceof Error ? error.message : String(error));
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div
      className={`rounded-lg border px-3 py-2 text-xs ${
        failed
          ? 'border-rose-700/60 bg-rose-950/30'
          : work.state === 'background'
            ? 'border-amber-600/60 bg-amber-950/25'
            : 'border-slate-600 bg-slate-800/70'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-100">
              {STATE_LABEL[work.state]}
            </span>
            <span className="text-slate-400">{elapsedLabel(work, now)}</span>
            {work.read_only_reason && (
              <span className="rounded bg-slate-700 px-1.5 py-0.5 text-slate-300">
                Read-only
              </span>
            )}
          </div>
          {work.summary && (
            <div className="mt-1 truncate text-slate-300">{work.summary}</div>
          )}
          <div className="mt-1 text-[10px] text-slate-400">
            Started {parseServerTimestamp(work.created_at).toLocaleTimeString()}
          </div>
          <div className="mt-1 truncate font-mono text-[10px] text-slate-500">
            Agent Work {work.id}
          </div>
        </div>
        {work.cancellable && (
          <button
            type="button"
            disabled={cancelling}
            onClick={cancel}
            className="rounded border border-rose-700 px-2 py-1 text-rose-200 hover:bg-rose-900/40 disabled:opacity-50"
          >
            {cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
      </div>
      {work.error && (
        <div className="mt-1 text-rose-300">{work.error}</div>
      )}
      {cancelError && (
        <div className="mt-1 text-rose-300">{cancelError}</div>
      )}
    </div>
  );
}

export function AgentWorkList() {
  const { currentSession, upsertAgentWork } = useSession();
  const [now, setNow] = useState(0);
  const works = useMemo(() => {
    const all = currentSession?.agent_work ?? [];
    const active = all.filter((work) => !TERMINAL_STATE[work.state]);
    const recent = all.filter((work) => TERMINAL_STATE[work.state]).slice(0, 3);
    return [...active, ...recent];
  }, [currentSession?.agent_work]);

  useEffect(() => {
    if (!works.some((work) => !TERMINAL_STATE[work.state])) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [works]);

  if (!currentSession || works.length === 0) return null;
  return (
    <div className="mb-4 space-y-2" aria-label="Agent Work">
      {works.map((work) => (
        <AgentWorkCard
          key={work.id}
          work={work}
          now={now}
          onUpdated={(updated) => upsertAgentWork(currentSession.id, updated)}
        />
      ))}
    </div>
  );
}
