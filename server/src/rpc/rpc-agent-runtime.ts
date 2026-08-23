import { mkdir } from 'fs/promises';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { StringDecoder } from 'string_decoder';
import { z } from 'zod';
import {
  AgentRuntimeError,
  type AgentHarness,
  type AgentRuntime,
  type AgentTurnRequest,
  type AgentTurnResult,
  type AgentUsage,
  type ManagedAgentRun,
  type ManagedProcessIdentity,
} from '../agent/agent.types';
import {
  observeProcessBirthMarker,
  terminateProcessGroup,
} from '../process/process-supervisor';
import { cleanForDisplay, cleanForSpeech } from '../agent/response-normalizer';
import type { ProfileConfig } from '../profiles';

interface RpcResponse {
  type: 'response';
  id?: string;
  command: string;
  success: boolean;
  error?: string;
  data?: unknown;
}

interface RpcEvent {
  type: string;
  [key: string]: unknown;
}

const lastTextSchema = z.object({ text: z.string().optional() }).passthrough();
const stateSchema = z
  .object({
    sessionFile: z.string().optional(),
    sessionId: z.string().optional(),
  })
  .passthrough();
const statsSchema = z
  .object({
    tokens: z
      .object({
        input: z.number().optional(),
        output: z.number().optional(),
        cacheRead: z.number().optional(),
        cacheWrite: z.number().optional(),
      })
      .optional(),
    cost: z
      .union([z.number(), z.object({ total: z.number().optional() })])
      .optional(),
    contextUsage: z
      .object({
        tokens: z.number().optional(),
        contextWindow: z.number().optional(),
      })
      .optional(),
  })
  .passthrough();

export interface RpcAgentOptions {
  harness: AgentHarness;
  label: string;
  binary: string;
  sessionRoot: string;
  profileExtension: string;
  completionEvent: string;
  startupArgs?: string[];
  continuationArgs(sessionId: string): string[];
  profileExtensions(config: ProfileConfig): string[];
}

export abstract class RpcAgentRuntime implements AgentRuntime {
  readonly harness: AgentHarness;
  readonly capabilities = {
    background: true,
    recursiveTermination: true,
    enforcedWriteRoots: true,
  } as const;

  protected constructor(private readonly options: RpcAgentOptions) {
    this.harness = options.harness;
  }

  async run(request: AgentTurnRequest): Promise<AgentTurnResult> {
    const managed = await this.startManaged(request);
    managed.activate?.();
    return managed.result;
  }

  async startManaged(request: AgentTurnRequest): Promise<ManagedAgentRun> {
    if (request.harness !== this.harness) {
      throw new AgentRuntimeError(
        'invalid_request',
        `${this.options.label} adapter received harness '${request.harness}'`,
      );
    }

    const runId = randomUUID();
    const sessionDir = join(this.options.sessionRoot, runId);
    await mkdir(sessionDir, { recursive: true });
    const args = [
      ...(this.options.startupArgs ?? []),
      '--mode',
      'rpc',
      '--session-dir',
      sessionDir,
      '--extension',
      this.options.profileExtension,
    ];
    for (const extension of this.options.profileExtensions(request.config)) {
      args.push('--extension', extension);
    }
    if (request.continuation?.harness === this.harness) {
      args.push(...this.options.continuationArgs(request.continuation.sessionId));
    }
    const model = request.model ?? request.config.models[this.harness];
    if (model) args.push('--model', model);
    if (request.effort) args.push('--thinking', request.effort);

    const child = spawn(this.options.binary, args, {
      cwd: request.config.cwd,
      env: {
        ...process.env,
        BOB_ACTIVE_PROFILE_PATH: request.config.path,
        BOB_ACTIVE_PROFILE_ID: request.profile,
        BOB_WORKSPACE_PATH: request.config.cwd,
        BOB_SYSTEM_PROMPT_PATH: request.config.systemPromptPath || '',
        BOB_SKILLS_PATH: request.config.skillsPath || '',
        BOB_WRITE_ROOTS_JSON: JSON.stringify(request.config.writeRoots),
        BOB_PROFILE_WEB_RESEARCH: request.config.webResearch ? 'true' : 'false',
        BOB_ADDITIONAL_TOOLS_JSON: JSON.stringify(
          request.config.additionalTools,
        ),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    if (!child.pid) {
      throw new AgentRuntimeError(
        'unavailable',
        `${this.options.label} did not expose a managed process id.`,
      );
    }

    const rpc = new RpcConnection(child, this.options.label);
    let birthMarker: string;
    try {
      birthMarker = await observeProcessBirthMarker(child.pid);
    } catch (error) {
      try {
        await terminateProcessGroup(
          { pid: child.pid, pgid: child.pid, birthMarker: '' },
          false,
        );
      } catch (terminationError) {
        throw new AgentRuntimeError(
          'unavailable',
          `${this.options.label} process identity could not be observed and its process group could not be verified stopped: ${String(terminationError)}`,
        );
      }
      throw this.normalizeError(error);
    }
    const identity: ManagedProcessIdentity = {
      pid: child.pid,
      pgid: child.pid,
      birthMarker,
    };
    let termination: Promise<void> | null = null;
    const terminate = () => {
      if (!termination) {
        termination = terminateProcessGroup(identity).catch((error) => {
          termination = null;
          throw error;
        });
      }
      return termination;
    };
    let activate!: () => void;
    const activated = new Promise<void>((resolve) => {
      activate = resolve;
    });
    const result = activated.then(() =>
      this.consumeManagedRun(request, rpc, terminate),
    );
    return {
      capabilities: this.capabilities,
      processIdentity: identity,
      runId,
      continuationBranch: sessionDir,
      activate,
      result,
      terminate,
    };
  }

  private async consumeManagedRun(
    request: AgentTurnRequest,
    rpc: RpcConnection,
    terminate: () => Promise<void>,
  ): Promise<AgentTurnResult> {
    try {
      const beforeStats = await rpc.command({ type: 'get_session_stats' });
      const prompt = await rpc.command({
        type: 'prompt',
        message: request.userMessage,
      });
      if (!prompt.success) {
        throw new AgentRuntimeError(
          'invalid_request',
          prompt.error || `${this.options.label} rejected the prompt.`,
        );
      }

      await rpc.waitForEvent(
        this.options.completionEvent,
        request.config.timeoutMs,
      );
      const [lastText, state, stats] = await Promise.all([
        rpc.command({ type: 'get_last_assistant_text' }),
        rpc.command({ type: 'get_state' }),
        rpc.command({ type: 'get_session_stats' }),
      ]);
      if (!lastText.success) {
        throw new AgentRuntimeError(
          'execution_failed',
          lastText.error || `${this.options.label} did not return an assistant response.`,
        );
      }
      if (!state.success) {
        throw new AgentRuntimeError(
          'execution_failed',
          state.error || `${this.options.label} did not return continuation state.`,
        );
      }
      const text = lastTextSchema.parse(lastText.data).text?.trim() ?? '';
      if (!text) {
        throw new AgentRuntimeError(
          'execution_failed',
          `${this.options.label} completed without an assistant response.`,
        );
      }
      const continuationState = stateSchema.parse(state.data);
      const sessionId =
        continuationState.sessionFile || continuationState.sessionId;
      return {
        displayText: cleanForDisplay(text),
        speechText: cleanForSpeech(text),
        continuation: sessionId
          ? { harness: this.harness, sessionId }
          : null,
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
      try {
        await terminate();
      } catch (error) {
        throw new AgentRuntimeError(
          'cleanup_unverified',
          `${this.options.label} process cleanup could not be verified: ${String(error)}`,
          error,
        );
      }
    }
  }

  protected extractUsage(
    data: unknown,
    previousData?: unknown,
  ): AgentUsage | null {
    const current = statsSchema.parse(data);
    if (!current.tokens) return null;
    const previous = previousData
      ? statsSchema.parse(previousData)
      : { tokens: undefined, cost: undefined };
    const previousTokens = previous.tokens ?? {};
    const delta = (key: keyof NonNullable<typeof current.tokens>) =>
      Math.max(
        0,
        (current.tokens?.[key] ?? 0) - (previousTokens[key] ?? 0),
      );
    const costOf = (cost: typeof current.cost): number =>
      typeof cost === 'number' ? cost : (cost?.total ?? 0);
    const contextTokens = current.contextUsage?.tokens;
    return {
      inputTokens: delta('input'),
      outputTokens: delta('output'),
      cacheReadTokens: delta('cacheRead'),
      cacheCreationTokens: delta('cacheWrite'),
      costUsd: Math.max(0, costOf(current.cost) - costOf(previous.cost)),
      contextWindow: current.contextUsage?.contextWindow ?? 200_000,
      ...(typeof contextTokens === 'number' ? { contextTokens } : {}),
    };
  }

  private normalizeError(error: unknown): AgentRuntimeError {
    const value = error as { code?: string; message?: string };
    if (value?.code === 'ENOENT') {
      return new AgentRuntimeError(
        'unavailable',
        `The ${this.options.label} executable is not available.`,
        error,
      );
    }
    return new AgentRuntimeError(
      'execution_failed',
      `${this.options.label} failed: ${value?.message || String(error)}`,
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
  private readonly seenEvents = new Map<string, number>();
  private readonly decoder = new StringDecoder('utf8');
  private buffer = '';

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly label: string,
  ) {
    child.stdout.on('data', (chunk: Buffer) => this.consume(chunk));
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.warn(`${this.label} stderr:`, text);
    });
    child.on('error', (error) => this.rejectAll(error));
    child.on('exit', (code, signal) => {
      this.rejectAll(
        new Error(
          `${this.label} exited with code ${code ?? 'unknown'}${signal ? ` from ${signal}` : ''}`,
        ),
      );
    });
  }

  command(
    command: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<RpcResponse> {
    const id = `bob-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `${this.label} RPC command '${String(command.type)}' timed out.`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.child.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    });
  }

  waitForEvent(type: string, timeoutMs: number): Promise<void> {
    const seen = this.seenEvents.get(type) ?? 0;
    if (seen > 0) {
      if (seen === 1) this.seenEvents.delete(type);
      else this.seenEvents.set(type, seen - 1);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new AgentRuntimeError(
              'timeout',
              `${this.label} timed out waiting for ${type}.`,
            ),
          ),
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
      try {
        this.handle(JSON.parse(line) as RpcResponse | RpcEvent);
      } catch (error) {
        this.rejectAll(
          new Error(`${this.label} returned malformed RPC output: ${String(error)}`),
        );
      }
    }
  }

  private handle(message: RpcResponse | RpcEvent): void {
    if (message.type === 'response' && typeof message.id === 'string') {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      waiter.resolve(message as RpcResponse);
      return;
    }
    const waiters = this.eventWaiters.get(message.type);
    if (!waiters) {
      this.seenEvents.set(message.type, (this.seenEvents.get(message.type) ?? 0) + 1);
      return;
    }
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
