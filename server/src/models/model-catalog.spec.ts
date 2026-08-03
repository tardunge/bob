import { getModelOptions, isValidModelForHarness } from './model-catalog';

describe('model catalog', () => {
  it('keeps Claude choices in the Claude harness catalog', () => {
    expect(getModelOptions('claude').map((model) => model.id)).toContain(
      'claude-opus-4-8',
    );
    expect(isValidModelForHarness('claude', 'claude-opus-4-8')).toBe(true);
    expect(isValidModelForHarness('claude', 'gpt-5.6-luna')).toBe(false);
  });

  it('loads Pi choices from environment rather than Claude constants', () => {
    expect(getModelOptions('pi', { BOB_PI_MODELS: 'gpt-5.6-luna, gpt-5.5' })).toEqual([
      { id: 'openai-codex/gpt-5.6-luna', label: 'GPT-5.6 Luna' },
      { id: 'openai-codex/gpt-5.5', label: 'GPT-5.5' },
    ]);
    expect(
      isValidModelForHarness('pi', 'openai-codex/gpt-5.6-luna', {
        BOB_PI_MODELS: 'gpt-5.6-luna',
      }),
    ).toBe(true);
    expect(
      isValidModelForHarness('pi', 'not allowed', {
        BOB_PI_MODELS: 'gpt-5.6-luna',
      }),
    ).toBe(false);
  });

  it('exposes the default Codex catalog and validates safe overrides', () => {
    expect(getModelOptions('pi', {}).map((model) => model.id)).toEqual([
      'openai-codex/gpt-5.6-luna',
      'openai-codex/gpt-5.3-codex-spark',
      'openai-codex/gpt-5.4',
      'openai-codex/gpt-5.4-mini',
      'openai-codex/gpt-5.5',
      'openai-codex/gpt-5.6-sol',
      'openai-codex/gpt-5.6-terra',
    ]);
    expect(isValidModelForHarness('pi', 'openai-codex/gpt-5.6-luna', {})).toBe(true);
    expect(isValidModelForHarness('pi', 'gpt-5.6-luna', {})).toBe(false);
  });
});
