import { spawn } from 'child_process';
import {
  observeProcessBirthMarker,
  processGroupExists,
  terminateProcessGroup,
} from './process-supervisor';

function spawnProcessGroup(
  script = 'setInterval(() => {}, 1000)',
) {
  const child = spawn(process.execPath, ['-e', script], {
    detached: true,
    stdio: 'ignore',
  });
  if (!child.pid) throw new Error('test child did not expose a pid');
  child.unref();
  return child.pid;
}

describe('process supervisor', () => {
  it('terminates and verifies an owned process group', async () => {
    const pid = spawnProcessGroup();
    const birthMarker = await observeProcessBirthMarker(pid);
    expect(processGroupExists(pid)).toBe(true);

    await terminateProcessGroup({ pid, pgid: pid, birthMarker }, true);

    expect(processGroupExists(pid)).toBe(false);
  });

  it('escalates a process group that survives SIGTERM after five seconds', async () => {
    const pid = spawnProcessGroup(
      `process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)`,
    );
    const birthMarker = await observeProcessBirthMarker(pid);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const startedAt = Date.now();

    await terminateProcessGroup({ pid, pgid: pid, birthMarker }, true);

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(4_900);
    expect(processGroupExists(pid)).toBe(false);
  }, 10_000);

  it('fails closed on a reused or mismatched process identity', async () => {
    const pid = spawnProcessGroup();
    const birthMarker = await observeProcessBirthMarker(pid);
    try {
      await expect(
        terminateProcessGroup(
          { pid, pgid: pid, birthMarker: `${birthMarker}-different` },
          true,
        ),
      ).rejects.toThrow(/birth marker/);
      expect(processGroupExists(pid)).toBe(true);
    } finally {
      await terminateProcessGroup({ pid, pgid: pid, birthMarker });
    }
  });
});
