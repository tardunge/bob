import { spawn } from 'child_process';

export interface ProcessInvocation {
  command: string;
  args: string[];
}

export interface RunProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBuffer?: number;
  input?: string;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
}

export type ProcessFailureKind = 'timeout' | 'unavailable' | 'execution_failed';

export class ProcessExecutionError extends Error {
  constructor(
    public readonly kind: ProcessFailureKind,
    message: string,
    public readonly exitCode?: number | null,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ProcessExecutionError';
  }
}

const DEFAULT_MAX_BUFFER = 1024 * 1024;

export function runProcess(
  command: string,
  args: string[],
  options: RunProcessOptions = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
    let size = 0;
    let settled = false;
    let timedOut = false;

    const finish = (error?: Error, result?: ProcessResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve(result!);
    };

    const append = (target: Buffer[], chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > maxBuffer) {
        child.kill('SIGTERM');
        finish(
          new ProcessExecutionError(
            'execution_failed',
            `${command} exceeded the ${maxBuffer}-byte output limit`,
            null,
          ),
        );
        return;
      }
      target.push(chunk);
    };

    child.stdout.on('data', (chunk: Buffer) => append(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => append(stderr, chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish(
        new ProcessExecutionError(
          error.code === 'ENOENT' ? 'unavailable' : 'execution_failed',
          `${command} could not be started: ${error.message}`,
          null,
          error,
        ),
      );
    });
    child.on('close', (code, signal) => {
      if (timedOut) {
        finish(
          new ProcessExecutionError(
            'timeout',
            `${command} exceeded the configured timeout`,
            code,
          ),
        );
      } else if (code !== 0) {
        finish(
          new ProcessExecutionError(
            'execution_failed',
            `${command} exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}`,
            code,
          ),
        );
      } else {
        finish(undefined, {
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        });
      }
    });

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, options.timeoutMs)
      : null;

    if (options.input !== undefined) child.stdin.write(options.input);
    child.stdin.end();
  });
}
