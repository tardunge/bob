import type { ProfileOption } from '../services/profilesApi';

function State({ enabled }: { enabled: boolean }) {
  return (
    <span
      className={`font-mono text-[10px] uppercase tracking-[0.18em] ${
        enabled ? 'text-cyan-300' : 'text-slate-500'
      }`}
    >
      {enabled ? 'enabled' : 'off'}
    </span>
  );
}

export function CapabilityPreflight({ profile }: { profile: ProfileOption }) {
  const { capabilities } = profile;
  const writeEnabled = capabilities.write.roots.length > 0;
  const shellEnabled = capabilities.operatorCommands.effective.length > 0;
  return (
    <section className="w-full max-w-2xl border border-slate-700/90 bg-slate-900/55 rounded-2xl overflow-hidden shadow-2xl shadow-slate-950/30">
      <header className="px-5 py-4 border-b border-slate-700/80 flex items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-300">
            Before the first turn
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-100">
            {profile.displayName} capability envelope
          </h2>
        </div>
        <span className="px-2.5 py-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 text-xs font-mono uppercase">
          {profile.defaultHarness}
        </span>
      </header>
      <div className="px-5 py-4 grid gap-3 text-sm">
        <div className="grid grid-cols-[7rem_1fr] gap-3">
          <span className="text-slate-500">Workspace</span>
          <code className="text-slate-200 text-xs break-all">{capabilities.workspace}</code>
        </div>
        <div className="grid grid-cols-[7rem_1fr_auto] gap-3 items-start">
          <span className="text-slate-500">Read boundary</span>
          <span className="text-slate-300">
            {capabilities.read.roots.join(', ') || 'none'} ·{' '}
            {capabilities.read.enforcement === 'harness-settings'
              ? 'enforced by harness settings'
              : 'workspace process access; not sandboxed to declared roots'}
          </span>
          <State enabled />
        </div>
        <div className="grid grid-cols-[7rem_1fr_auto] gap-3 items-start">
          <span className="text-slate-500">Write boundary</span>
          <span className="text-slate-300">
            {writeEnabled
              ? `${capabilities.write.roots.join(', ')} · ${capabilities.write.enforcement}`
              : 'No write roots declared'}
          </span>
          <State enabled={writeEnabled} />
        </div>
        <div className="grid grid-cols-[7rem_1fr_auto] gap-3 items-start">
          <span className="text-slate-500">Shell</span>
          <span className="text-slate-300">
            {shellEnabled
              ? capabilities.operatorCommands.effective.join(', ')
              : capabilities.operatorCommands.declared.length > 0
                ? 'Declared commands are not supported by this harness adapter'
                : 'No operator commands declared'}
          </span>
          <State enabled={shellEnabled} />
        </div>
      </div>
      <footer className="px-5 py-3 border-t border-slate-700/80 flex flex-wrap gap-x-5 gap-y-2 bg-slate-950/30">
        <span className="text-xs text-slate-400">
          Web research <State enabled={capabilities.webResearch} />
        </span>
        <span className="text-xs text-slate-400">
          MCP <State enabled={capabilities.mcp.effective} />
        </span>
        <span className="text-xs text-slate-400">
          Background work <State enabled={capabilities.backgroundWork} />
        </span>
        <span className="text-xs text-slate-400">
          Extensions <span className="font-mono text-slate-300">{capabilities.extensions}</span>
        </span>
      </footer>
    </section>
  );
}
