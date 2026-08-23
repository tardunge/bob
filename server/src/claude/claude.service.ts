import { Injectable } from '@nestjs/common';
import { readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  DEFAULT_PROFILE,
  getProfileConfig,
  type SessionProfile,
} from '../profiles';
import { buildClaudeCommand } from './claude-command';
import {
  MODEL_CONTEXT_WINDOWS,
  VALID_EFFORT_LEVELS,
  VALID_MODELS,
  type EffortLevel,
} from './claude-command';
import {
  AgentRuntimeError,
  type AgentRuntime,
  type AgentTurnRequest,
  type AgentTurnResult,
  type AgentUsage,
} from '../agent/agent.types';
import {
  cleanForDisplay,
  cleanForSpeech,
} from '../agent/response-normalizer';
import {
  ProcessExecutionError,
  runProcess,
} from '../process/process-runner';

export interface ClaudeResponse {
  response: string;
  speechText: string;
  sessionId: string | null;
  usage: AgentUsage | null;
}

interface ClaudeCLIUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface ClaudeCLIModelUsage {
  contextWindow?: number;
}

interface ClaudeCLIResponse {
  type: string;
  result: string;
  session_id: string;
  total_cost_usd?: number;
  usage?: ClaudeCLIUsage;
  modelUsage?: Record<string, ClaudeCLIModelUsage>;
}

@Injectable()
export class ClaudeService implements AgentRuntime {
  readonly harness = 'claude' as const;
  readonly capabilities = {
    background: false,
    recursiveTermination: false,
    enforcedWriteRoots: false,
  } as const;
  private materializeMcpConfig(
    source: string | null | undefined,
    profilePath: string,
    profileId: string,
  ): string | null {
    if (!source) return null;
    const raw = readFileSync(source, 'utf8');
    if (!raw.includes('${PROFILE_DIR}') && !raw.includes('${DATABASE_PATH}')) {
      return source;
    }
    const databasePath =
      process.env.DATABASE_PATH || join(process.cwd(), 'bob.db');
    const resolved = raw
      .replaceAll('${PROFILE_DIR}', profilePath)
      .replaceAll('${DATABASE_PATH}', databasePath);
    JSON.parse(resolved);
    const target = join(tmpdir(), `bob-${profileId}-mcp.json`);
    writeFileSync(target, resolved, { mode: 0o600 });
    return target;
  }


  async run(request: AgentTurnRequest): Promise<AgentTurnResult> {
    if (request.harness !== this.harness) {
      throw new AgentRuntimeError(
        'invalid_request',
        `Claude adapter received harness '${request.harness}'`,
      );
    }

    const continuation =
      request.continuation?.harness === 'claude'
        ? request.continuation.sessionId
        : null;
    const invocation = buildClaudeCommand({
      userMessage: request.userMessage,
      config: request.config,
      mcpConfigPath: this.materializeMcpConfig(
        request.mcpConfigPath ?? request.config.mcpConfigPath,
        request.config.path,
        request.config.id,
      ),
      claudeSessionId: continuation,
      effort: request.effort as EffortLevel | null | undefined,
      model: request.model,
      claudePath: process.env.BOB_CLAUDE_BINARY,
    });

    try {
      const headroomBaseUrl = process.env.HEADROOM_BASE_URL;
      const { stdout, stderr } = await runProcess(
        invocation.command,
        invocation.args,
        {
          timeoutMs: request.config.timeoutMs,
          maxBuffer: 1024 * 1024,
          env: {
            ...process.env,
            PATH: process.env.PATH,
            ...(headroomBaseUrl ? { ANTHROPIC_BASE_URL: headroomBaseUrl } : {}),
          },
          cwd: request.config.cwd,
        },
      );

      if (stderr) console.warn('Claude CLI stderr:', stderr);
      const cliResponse: ClaudeCLIResponse = JSON.parse(stdout);
      const displayText = cleanForDisplay(cliResponse.result);

      return {
        displayText,
        speechText: cleanForSpeech(cliResponse.result),
        continuation: cliResponse.session_id
          ? { harness: 'claude', sessionId: cliResponse.session_id }
          : null,
        usage: this.extractUsage(
          cliResponse,
          request.model ?? request.config.models.claude,
        ),
      };
    } catch (error) {
      throw this.normalizeError(error);
    }
  }

  // Compatibility surface for existing callers and the integration test. New
  // pipeline code goes through AgentRuntime.run instead.
  async chat(
    userMessage: string,
    claudeSessionId?: string | null,
    profile: SessionProfile = DEFAULT_PROFILE,
    effort?: EffortLevel | null,
    model?: string | null,
  ): Promise<ClaudeResponse> {
    const config = getProfileConfig(profile);
    const result = await this.run({
      userMessage,
      harness: 'claude',
      profile,
      config,
      mcpConfigPath: config.mcpConfigPath,
      continuation: claudeSessionId
        ? { harness: 'claude', sessionId: claudeSessionId }
        : null,
      effort,
      model,
    });
    return {
      response: result.displayText,
      speechText: result.speechText,
      sessionId: result.continuation?.sessionId ?? null,
      usage: result.usage,
    };
  }

  private normalizeError(error: unknown): AgentRuntimeError {
    if (error instanceof ProcessExecutionError) {
      return new AgentRuntimeError(
        error.kind,
        `Claude Code failed: ${error.message}`,
        error,
      );
    }
    return new AgentRuntimeError(
      'execution_failed',
      `Claude Code failed: ${String(error)}`,
      error,
    );
  }

  private extractUsage(
    cli: ClaudeCLIResponse,
    effectiveModel?: string | null,
  ): AgentUsage | null {
    const u = cli.usage;
    if (!u) return null;
    const models = cli.modelUsage ? Object.values(cli.modelUsage) : [];
    const reportedMax = models.reduce(
      (max, m) => Math.max(max, m.contextWindow ?? 0),
      0,
    );
    const knownWindow = effectiveModel
      ? (MODEL_CONTEXT_WINDOWS[effectiveModel] ?? 0)
      : 0;
    const contextWindow = knownWindow || reportedMax || 200_000;
    return {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
      costUsd: cli.total_cost_usd ?? 0,
      contextWindow,
    };
  }

  cleanForDisplay(response: string): string {
    return cleanForDisplay(response);
  }

  cleanForSpeech(response: string): string {
    return cleanForSpeech(response);
  }
}

export {
  VALID_EFFORT_LEVELS,
  VALID_MODELS,
  type EffortLevel,
} from './claude-command';
export type { AgentUsage as ClaudeUsage } from '../agent/agent.types';
