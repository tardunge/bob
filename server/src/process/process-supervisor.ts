import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ManagedProcessIdentity } from '../agent/agent.types';
import { setTimeout as delay } from 'timers/promises';

const execFileAsync = promisify(execFile);
const TERMINATION_GRACE_MS = 5_000;
const KILL_VERIFICATION_MS = 1_000;
const PROCESS_CHECK_INTERVAL_MS = 50;

export async function observeProcessBirthMarker(pid: number): Promise<string> {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error(`Invalid managed process id: ${pid}`);
  }
  const { stdout } = await execFileAsync('ps', [
    '-o',
    'lstart=',
    '-p',
    String(pid),
  ]);
  const marker = stdout.trim();
  if (!marker) {
    throw new Error(`Managed process ${pid} exited before its identity was observed.`);
  }
  return marker;
}

export function processGroupExists(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    throw error;
  }
}
async function waitForProcessGroupExit(
  pgid: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processGroupExists(pgid)) return true;
    await delay(PROCESS_CHECK_INTERVAL_MS);
  }
  return !processGroupExists(pgid);
}

function signalProcessGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

export async function terminateProcessGroup(
  identity: ManagedProcessIdentity,
  verifyBirthMarker = false,
): Promise<void> {
  if (!processGroupExists(identity.pgid)) return;

  if (verifyBirthMarker) {
    let observed: string;
    try {
      observed = await observeProcessBirthMarker(identity.pid);
    } catch (error) {
      if (!processGroupExists(identity.pgid)) return;
      throw new Error(
        `Cannot verify managed process group ${identity.pgid}: ${String(error)}`,
      );
    }
    if (observed !== identity.birthMarker) {
      throw new Error(
        `Managed process ${identity.pid} no longer matches its persisted birth marker.`,
      );
    }
  }

  signalProcessGroup(identity.pgid, 'SIGTERM');
  if (await waitForProcessGroupExit(identity.pgid, TERMINATION_GRACE_MS)) return;

  signalProcessGroup(identity.pgid, 'SIGKILL');
  if (await waitForProcessGroupExit(identity.pgid, KILL_VERIFICATION_MS)) return;

  throw new Error(
    `Managed process group ${identity.pgid} still exists after SIGKILL.`,
  );
}
