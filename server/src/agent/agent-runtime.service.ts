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
  type AgentRuntimeCapabilities,
  type AgentTurnRequest,
  type AgentTurnResult,
  type ManagedAgentRun,
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
  capabilitiesFor(harness: AgentHarness): AgentRuntimeCapabilities {
    if (isOfflineTestMode()) {
      return {
        background: harness === 'pi',
        recursiveTermination: harness === 'pi',
        enforcedWriteRoots: harness === 'pi',
      };
    }
    const runtime = this.runtimes[harness];
    if (!runtime) {
      throw new BadRequestException(`Unknown agent harness '${String(harness)}'.`);
    }
    return runtime.capabilities;
  }

  async start(request: AgentTurnRequest): Promise<ManagedAgentRun> {
    if (isOfflineTestMode()) {
      return {
        capabilities: this.capabilitiesFor(request.harness),
        processIdentity: null,
        runId: null,
        continuationBranch: null,
        activate: null,
        result: this.offline.run(request),
        terminate: null,
      };
    }
    const runtime = this.runtimes[request.harness];
    if (!runtime) {
      throw new BadRequestException(
        `Unknown agent harness '${String(request.harness)}'.`,
      );
    }
    if (runtime.startManaged) return runtime.startManaged(request);
    return {
      capabilities: runtime.capabilities,
      processIdentity: null,
      activate: null,
      runId: null,
      continuationBranch: null,
      result: runtime.run(request),
      terminate: null,
    };
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
