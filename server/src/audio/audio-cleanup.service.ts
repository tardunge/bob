import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { AUDIO_DIR, AUDIO_TTL_MS } from './audio.constants';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly

@Injectable()
export class AudioCleanupService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(AudioCleanupService.name);
  private intervalHandle: NodeJS.Timeout | null = null;

  onApplicationBootstrap() {
    if (!existsSync(AUDIO_DIR)) {
      mkdirSync(AUDIO_DIR, { recursive: true });
    }
    this.sweep();
    this.intervalHandle = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
  }

  onApplicationShutdown() {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
  }

  private sweep() {
    const cutoff = Date.now() - AUDIO_TTL_MS;
    let removed = 0;
    try {
      for (const name of readdirSync(AUDIO_DIR)) {
        const path = join(AUDIO_DIR, name);
        try {
          const stat = statSync(path);
          if (stat.isFile() && stat.mtimeMs < cutoff) {
            unlinkSync(path);
            removed++;
          }
        } catch (err) {
          this.logger.warn(`Failed to inspect/remove ${path}: ${String(err)}`);
        }
      }
      if (removed > 0) {
        this.logger.log(`Swept ${removed} audio file(s) older than 24h from ${AUDIO_DIR}`);
      }
    } catch (err) {
      this.logger.warn(`Sweep failed: ${String(err)}`);
    }
  }
}
