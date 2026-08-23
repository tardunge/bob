import { Injectable } from '@nestjs/common';
import { join, resolve } from 'path';
import { RpcAgentRuntime } from '../rpc/rpc-agent-runtime';

@Injectable()
export class OmpService extends RpcAgentRuntime {
  constructor() {
    super({
      harness: 'omp',
      label: 'OMP',
      binary: process.env.BOB_OMP_BINARY || 'omp',
      sessionRoot:
        process.env.BOB_OMP_SESSION_DIR ||
        join(resolve(__dirname, '../../..'), '.bob', 'agent-sessions', 'omp'),
      profileExtension: join(
        resolve(__dirname, '../..'),
        'pi',
        'profile-extension.ts',
      ),
      completionEvent: 'agent_end',
      startupArgs: ['--no-extensions'],
      continuationArgs: (sessionId) => ['--resume', sessionId],
      profileExtensions: (config) => config.ompExtensions,
    });
  }
}
