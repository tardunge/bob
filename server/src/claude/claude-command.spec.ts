import {
  buildClaudeInvocation,
  buildPermissionSettings,
  VALID_EFFORT_LEVELS,
  VALID_MODELS,
} from './claude-command';
import type { ProfileConfig } from '../profiles';

const config: ProfileConfig = {
  id: 'sample',
  displayName: 'Bob',
  description: 'Test profile',
  path: '/profiles/sample',
  defaultHarness: 'pi',
  cwd: '/workspace',
  systemPrompt: 'You are Bob.',
  systemPromptPath: '/profiles/sample/SYSTEM.md',
  readRoots: ['.'],
  allowedTools: ['WebSearch'],
  writeRoots: ['docs'],
  timeoutMs: 600_000,
  models: { claude: 'claude-opus-4-8' },
  piperModelPath: null,
  whisperPrompt: null,
  whisperTimeoutMs: 600_000,
  skillsPath: null,
  mcpConfigPath: null,
  piExtensions: [],
};

const base = { userMessage: 'hello bob', config, mcpConfigPath: '/app/mcp.json' };

describe('buildClaudeInvocation', () => {
  it('assembles a fresh-session argv with the profile prompt and model', () => {
    const invocation = buildClaudeInvocation(base);
    expect(invocation.command).toBe('claude');
    expect(invocation.args).toContain('--system-prompt');
    expect(invocation.args).toContain('You are Bob.');
    expect(invocation.args).toContain('claude-opus-4-8');
    expect(invocation.args).toContain('/app/mcp.json');
    expect(invocation.args.at(-2)).toBe('--');
    expect(invocation.args.at(-1)).toBe('hello bob');
  });

  it('uses resume and omits the system prompt', () => {
    const invocation = buildClaudeInvocation({ ...base, claudeSessionId: 'sess-123' });
    expect(invocation.args).toContain('--resume');
    expect(invocation.args).toContain('sess-123');
    expect(invocation.args).not.toContain('--system-prompt');
  });

  it('omits MCP configuration when the profile has none', () => {
    const invocation = buildClaudeInvocation({
      userMessage: 'hello',
      config,
      mcpConfigPath: null,
    });
    expect(invocation.args).not.toContain('--mcp-config');
  });

  it('passes shell-significant and dash-led prompts as literal argv values', () => {
    const quoted = buildClaudeInvocation({ ...base, userMessage: "it's a 'test'" });
    expect(quoted.args.at(-1)).toBe("it's a 'test'");
    const dash = buildClaudeInvocation({ ...base, userMessage: '- the first thing' });
    expect(dash.args.at(-2)).toBe('--');
    expect(dash.args.at(-1)).toBe('- the first thing');
  });

  it('rejects values outside the effort and model whitelists', () => {
    expect(() => buildClaudeInvocation({ ...base, effort: 'ultra' as never })).toThrow(
      /Invalid effort/,
    );
    expect(() =>
      buildClaudeInvocation({ ...base, model: 'evil; rm -rf /' }),
    ).toThrow(/Invalid model/);
  });

  it('accepts every whitelisted effort and model', () => {
    for (const level of VALID_EFFORT_LEVELS) {
      expect(() => buildClaudeInvocation({ ...base, effort: level })).not.toThrow();
    }
    for (const model of VALID_MODELS) {
      expect(() => buildClaudeInvocation({ ...base, model })).not.toThrow();
    }
  });
});

describe('buildPermissionSettings', () => {
  const settings = JSON.parse(
    buildPermissionSettings(
      config.cwd,
      config.readRoots,
      config.allowedTools,
      config.writeRoots,
    ),
  );
  const allow: string[] = settings.permissions.allow;

  it('uses dontAsk mode with no deny rules', () => {
    expect(settings.permissions.defaultMode).toBe('dontAsk');
    expect(settings.permissions.deny).toBeUndefined();
  });

  it('scopes reads and writes to declared roots', () => {
    expect(allow).toContain('Read(/workspace/**)');
    expect(allow).toContain('Grep(/workspace/**)');
    expect(allow).toContain('Glob(/workspace/**)');
    expect(allow).toContain('Edit(/workspace/docs/**)');
    expect(allow).toContain('Write(/workspace/docs/**)');
    expect(allow).not.toContain('Write(/workspace/**)');
  });
});
