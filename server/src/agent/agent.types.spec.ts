import { getDefaultAgentHarness } from './agent.types';

describe('getDefaultAgentHarness', () => {
  it('defaults to Pi', () => {
    expect(getDefaultAgentHarness({})).toBe('pi');
  });

  it('allows the optional Claude CLI harness', () => {
    expect(getDefaultAgentHarness({ BOB_AGENT_HARNESS: 'claude' })).toBe(
      'claude',
    );
  });

  it('allows the optional OMP harness', () => {
    expect(getDefaultAgentHarness({ BOB_AGENT_HARNESS: 'omp' })).toBe('omp');
  });

  it('rejects unsupported harness names', () => {
    expect(() => getDefaultAgentHarness({ BOB_AGENT_HARNESS: 'codex' })).toThrow(
      /Valid harnesses: claude, omp, pi/,
    );
  });
});
