import { ProcessExecutionError, runProcess } from './process-runner';

describe('runProcess', () => {
  it('passes arguments and stdin literally without a shell', async () => {
    const result = await runProcess(
      process.execPath,
      ['-e', "process.stdout.write(process.argv[1] + ':' + require('fs').readFileSync(0, 'utf8'))", "it's safe; $HOME"],
      { input: 'input; rm -rf /' },
    );
    expect(result.stdout).toBe("it's safe; $HOME:input; rm -rf /");
  });

  it('reports a missing executable as unavailable', async () => {
    await expect(runProcess('/definitely/missing/bob-command', [])).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('reports timeout separately from process failure', async () => {
    await expect(
      runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(ProcessExecutionError);
    await expect(
      runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 1000)'], { timeoutMs: 10 }),
    ).rejects.toMatchObject({ kind: 'timeout' });
  });
});
