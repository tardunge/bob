import { BadRequestException, Injectable } from '@nestjs/common';
import { ClaudeService } from '../claude/claude.service';
import { PiRpcService } from '../pi/pi-rpc.service';
import {
  isOfflineTestMode,
  OfflineRuntimeService,
} from './offline-runtime.service';
import {
  type AgentHarness,
  type AgentRuntime,
  type AgentTurnRequest,
  type AgentTurnResult,
} from './agent.types';

@Injectable()
export class AgentRuntimeService {
  private readonly runtimes: Record<AgentHarness, AgentRuntime>;

  constructor(
    claude: ClaudeService,
    pi: PiRpcService,
    private readonly offline: OfflineRuntimeService,
  ) {
    this.runtimes = { claude, pi };
  }

  run(request: AgentTurnRequest): Promise<AgentTurnResult> {
    if (isOfflineTestMode()) return this.offline.run(request);
    const runtime = this.runtimes[request.harness];
    if (!runtime) {
      throw new BadRequestException(
        `Unknown agent harness '${String(request.harness)}'.`,
      );
    }
    return runtime.run(request);
  }
}
