import { Injectable } from '@nestjs/common';
import type { AgentTurnRequest, AgentTurnResult } from './agent.types';

export function isOfflineTestMode(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.BOB_TEST_MODE === 'offline';
}

@Injectable()
export class OfflineRuntimeService {
  async run(request: AgentTurnRequest): Promise<AgentTurnResult> {
    const text = `Offline test response: ${request.userMessage}`;
    return {
      displayText: text,
      speechText: text,
      continuation: null,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0,
        contextWindow: 0,
        contextTokens: 0,
      },
    };
  }
}
