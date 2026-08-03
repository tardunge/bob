import type { SessionUsage } from '../types/session';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

function formatCost(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

export function SessionUsageChip({ usage }: { usage: SessionUsage | null }) {
  if (!usage || !usage.latest) {
    return (
      <div
        className="text-xs text-slate-500 font-mono"
        title="No usage recorded yet for this session"
      >
        —
      </div>
    );
  }

  const { latest, cumulative } = usage;
  // Pi reports the actual current context separately from cumulative token
  // accounting. Claude has no equivalent field, so retain the fallback.
  const ctxUsed =
    latest.contextTokens ??
    (latest.inputTokens + latest.cacheReadTokens + latest.cacheCreationTokens);
  const ctxWindow = latest.contextWindow || 200_000;
  const pct = Math.min(100, Math.round((ctxUsed / ctxWindow) * 100));

  const color =
    pct >= 85
      ? 'text-red-300 border-red-500/40 bg-red-500/10'
      : pct >= 60
        ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
        : 'text-slate-300 border-slate-700 bg-slate-800/40';

  const cumTokens =
    cumulative.inputTokens +
    cumulative.outputTokens +
    cumulative.cacheReadTokens +
    cumulative.cacheCreationTokens;

  const tooltip =
    `Context: ${ctxUsed.toLocaleString()} / ${ctxWindow.toLocaleString()} (${pct}%)\n` +
    `Cumulative — in: ${cumulative.inputTokens.toLocaleString()}, ` +
    `out: ${cumulative.outputTokens.toLocaleString()}, ` +
    `cache read: ${cumulative.cacheReadTokens.toLocaleString()}, ` +
    `cache write: ${cumulative.cacheCreationTokens.toLocaleString()}\n` +
    `Cost: ${formatCost(cumulative.costUsd)}`;

  return (
    <div
      className={`text-xs font-mono px-2 py-1 rounded border ${color}`}
      title={tooltip}
    >
      {pct}% · {formatTokens(cumTokens)} tok · {formatCost(cumulative.costUsd)}
    </div>
  );
}
