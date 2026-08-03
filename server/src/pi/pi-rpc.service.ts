import { Injectable } from '@nestjs/common';
import { mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { StringDecoder } from 'string_decoder';
import {
  AgentRuntimeError,
  type AgentRuntime,
  type AgentTurnRequest,
  type AgentTurnResult,
  type AgentUsage,
} from '../agent/agent.types';
import { cleanForDisplay, cleanForSpeech } from '../agent/response-normalizer';

interface RpcResponse {
  type: 'response';
  id?: string;
  command: string;
  success: boolean;
  error?: string;
  data?: any;
}

interface RpcEvent {
  type: string;
  [key: string]: any;
}

@Injectable()
export class PiRpcService implements AgentRuntime {
  readonly harness = 'pi' as const;
  private readonly piPath = process.env.BOB_PI_BINARY || 'pi';

  async run(request: AgentTurnRequest): Promise<AgentTurnResult> {
    if (request.harness !== this.harness) {
      throw new AgentRuntimeError(
        'invalid_request',
        `Pi adapter received harness '${request.harness}'`,
      );
    }

    const sessionDir =
      process.env.BOB_PI_SESSION_DIR ||
      join(resolve(__dirname, '../../..'), '.bob', 'agent-sessions', 'pi');
    await mkdir(sessionDir, { recursive: true });

    const extensionPath = join(
      resolve(__dirname, '../..'),
      'pi',
      'profile-extension.ts',
    );
    const args = [
      '--mode',
      'rpc',
      '--session-dir',
      sessionDir,
      '--extension',
      extensionPath,
    ];
    for (const profileExtension of request.config.piExtensions) {
      args.push('--extension', profileExtension);
    }
    if (request.continuation?.harness === 'pi') {
      args.push('--session', request.continuation.sessionId);
    }
    const model = request.model ?? request.config.models.pi;
    if (model) args.push('--model', model);
    if (request.effort) args.push('--thinking', request.effort);

    const child = spawn(this.piPath, args, {
      cwd: request.config.cwd,
      env: {
        ...process.env,
        BOB_ACTIVE_PROFILE_PATH: request.config.path,
        BOB_ACTIVE_PROFILE_ID: request.profile,
        BOB_WORKSPACE_PATH: request.config.cwd,
        BOB_SYSTEM_PROMPT_PATH: request.config.systemPromptPath || '',
        BOB_SKILLS_PATH: request.config.skillsPath || '',
        BOB_WRITE_ROOTS_JSON: JSON.stringify(request.config.writeRoots),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    try {
      const rpc = new RpcConnection(child);
      // Pi's get_session_stats is session-cumulative, while Bob persists
      // per-turn usage. Snapshot before prompting so the stored value is the
      // delta for this turn rather than the entire Pi session repeated again.
      const beforeStats = await rpc.command({ type: 'get_session_stats' });
      const prompt = await rpc.command({
        type: 'prompt',
        message: request.userMessage,
      });
      if (!prompt.success) {
        throw new AgentRuntimeError(
          'invalid_request',
          prompt.error || 'Pi rejected the prompt.',
        );
      }

      await rpc.waitForEvent('agent_settled', request.config.timeoutMs);
      const [lastText, state, stats] = await Promise.all([
        rpc.command({ type: 'get_last_assistant_text' }),
        rpc.command({ type: 'get_state' }),
        rpc.command({ type: 'get_session_stats' }),
      ]);
      if (!lastText.success) {
        throw new AgentRuntimeError(
          'execution_failed',
          lastText.error || 'Pi did not return an assistant response.',
        );
      }

      const text = String(lastText.data?.text || '').trim();
      if (!text) {
        throw new AgentRuntimeError(
          'execution_failed',
          'Pi completed without an assistant response.',
        );
      }

      const sessionId = state.data?.sessionFile || state.data?.sessionId;
      return {
        displayText: cleanForDisplay(text),
        speechText: cleanForSpeech(text),
        continuation: sessionId ? { harness: 'pi', sessionId } : null,
        usage: stats.success
          ? this.extractUsage(
              stats.data,
              beforeStats.success ? beforeStats.data : undefined,
            )
          : null,
      };
    } catch (error) {
      if (error instanceof AgentRuntimeError) throw error;
      throw this.normalizeError(error);
    } finally {
      child.kill('SIGTERM');
    }
  }

  private extractUsage(data: any, previousData?: any): AgentUsage | null {
    const tokens = data?.tokens;
    if (!tokens) return null;
    const previous = previousData?.tokens ?? {};
    const delta = (key: string) =>
      Math.max(0, Number(tokens[key] ?? 0) - Number(previous[key] ?? 0));
    const currentCost =
      typeof data?.cost === 'number' ? data.cost : Number(data?.cost?.total ?? 0);
    const previousCost =
      typeof previousData?.cost === 'number'
        ? previousData.cost
        : Number(previousData?.cost?.total ?? 0);
    const contextTokens = data?.contextUsage?.tokens;
    return {
      inputTokens: delta('input'),
      outputTokens: delta('output'),
      cacheReadTokens: delta('cacheRead'),
      cacheCreationTokens: delta('cacheWrite'),
      costUsd: Math.max(0, currentCost - previousCost),
      contextWindow: data?.contextUsage?.contextWindow ?? 200_000,
      ...(typeof contextTokens === 'number' ? { contextTokens } : {}),
    };
  }

  private normalizeError(error: unknown): AgentRuntimeError {
    const value = error as { code?: string; message?: string };
    if (value?.code === 'ENOENT') {
      return new AgentRuntimeError(
        'unavailable',
        'The Pi executable is not available.',
        error,
      );
    }
    return new AgentRuntimeError(
      'execution_failed',
      `Pi failed: ${value?.message || String(error)}`,
      error,
    );
  }
}

class RpcConnection {
  private nextId = 1;
  private readonly pending = new Map<
    string,
    { resolve: (value: RpcResponse) => void; reject: (error: unknown) => void }
  >();
  private readonly eventWaiters = new Map<
    string,
    Array<{ resolve: () => void; reject: (error: unknown) => void }>
  >();
  private readonly decoder = new StringDecoder('utf8');
  private buffer = '';

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.on('data', (chunk: Buffer) => this.consume(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.warn('Pi stderr:', text);
    });
    child.on('error', (error) => this.rejectAll(error));
    child.on('exit', (code, signal) => {
      // A Pi process exiting cleanly before agent_settled is still a failed
      // turn. Do not leave Bob's lifecycle stuck in "processing" forever.
      if (signal !== 'SIGTERM') {
        this.rejectAll(new Error(`Pi exited with code ${code ?? 'unknown'}`));
      }
    });
  }

  command(command: Record<string, unknown>): Promise<RpcResponse> {
    const id = `bob-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ ...command, id }) + '\n');
    });
  }

  waitForEvent(type: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new AgentRuntimeError('timeout', `Pi timed out waiting for ${type}.`)),
        timeoutMs,
      );
      const waiter = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      const waiters = this.eventWaiters.get(type) || [];
      waiters.push(waiter);
      this.eventWaiters.set(type, waiters);
    });
  }

  private consume(chunk: Buffer): void {
    this.buffer += this.decoder.write(chunk);
    while (true) {
      const newline = this.buffer.indexOf('\n');
      if (newline === -1) return;
      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line) continue;
      this.handle(JSON.parse(line) as RpcResponse | RpcEvent);
    }
  }

  private handle(message: RpcResponse | RpcEvent): void {
    if (message.type === 'response' && message.id) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      waiter.resolve(message as RpcResponse);
      return;
    }
    const waiters = this.eventWaiters.get(message.type);
    if (!waiters) return;
    this.eventWaiters.delete(message.type);
    for (const waiter of waiters) waiter.resolve();
  }

  private rejectAll(error: unknown): void {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
    for (const waiters of this.eventWaiters.values()) {
      for (const waiter of waiters) waiter.reject(error);
    }
    this.eventWaiters.clear();
  }
}
