import { Injectable } from '@nestjs/common';
import { join } from 'path';
import { tmpdir } from 'os';
import { runProcess } from '../process/process-runner';
import { isOfflineTestMode } from '../agent/offline-runtime.service';


@Injectable()
export class PiperService {
  private readonly piperPath = process.env.BOB_PIPER_BINARY || 'piper';

  async synthesize(text: string, modelPath: string | null): Promise<string | null> {
    if (isOfflineTestMode()) return null;
    if (!text || !text.trim()) {
      console.log('Skipping piper synthesis: empty text');
      return null;
    }
    if (!modelPath) {
      console.log('Skipping piper synthesis: no voice model configured');
      return null;
    }

    const outputPath = join(tmpdir(), `bob-output-${Date.now()}.wav`);

    try {
      const startedAt = Date.now();
      console.log(`Running piper command (chars=${text.length})...`);
      const { stderr } = await runProcess(
        this.piperPath,
        ['-m', modelPath, '-f', outputPath],
        { timeoutMs: 180_000, input: text },
      );
      console.log(`Piper finished in ${Date.now() - startedAt}ms`);
      if (stderr) console.warn('Piper stderr:', stderr);
      return outputPath;
    } catch (error) {
      console.error('Piper synthesis error:', error);
      throw new Error(`Failed to synthesize speech: ${error}`);
    }
  }
}
