import { PiRpcService } from './pi-rpc.service';

describe('PiRpcService usage mapping', () => {
  it('converts cumulative Pi stats into per-turn usage', () => {
    const service = new PiRpcService();
    const extract = (service as any).extractUsage.bind(service);
    expect(
      extract(
        {
          tokens: { input: 130, output: 25, cacheRead: 90, cacheWrite: 10 },
          cost: 0.42,
          contextUsage: { tokens: 115, contextWindow: 372_000 },
        },
        {
          tokens: { input: 100, output: 20, cacheRead: 70, cacheWrite: 5 },
          cost: 0.30,
        },
      ),
    ).toEqual({
      inputTokens: 30,
      outputTokens: 5,
      cacheReadTokens: 20,
      cacheCreationTokens: 5,
      costUsd: 0.12,
      contextTokens: 115,
      contextWindow: 372_000,
    });
  });
});
