import { Injectable } from '@nestjs/common';
import { join, resolve } from 'path';
import { RpcAgentRuntime } from '../rpc/rpc-agent-runtime';

@Injectable()
export class PiRpcService extends RpcAgentRuntime {
  constructor() {
    super({
      harness: 'pi',
      label: 'Pi',
      binary: process.env.BOB_PI_BINARY || 'pi',
      sessionRoot:
        process.env.BOB_PI_SESSION_DIR ||
        join(resolve(__dirname, '../../..'), '.bob', 'agent-sessions', 'pi'),
      profileExtension: join(
        resolve(__dirname, '../..'),
        'pi',
        'profile-extension.ts',
      ),
      completionEvent: 'agent_settled',
      continuationArgs: (sessionId) => ['--fork', sessionId],
      profileExtensions: (config) => config.piExtensions,
    });
  }
}
