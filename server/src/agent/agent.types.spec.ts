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

  it('rejects unsupported harness names, including OMP', () => {
    expect(() => getDefaultAgentHarness({ BOB_AGENT_HARNESS: 'omp' })).toThrow(
      /Valid harnesses: claude, pi/,
    );
  });
});
