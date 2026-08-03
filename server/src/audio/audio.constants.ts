import { tmpdir } from 'os';
import { join } from 'path';

export const AUDIO_DIR = join(tmpdir(), 'bob-audio');

// 24h TTL — audio served from this dir is reachable by URL for this long
// after creation, then swept by AudioCleanupService.
export const AUDIO_TTL_MS = 24 * 60 * 60 * 1000;

export function assistantAudioFilename(messageId: number): string {
  return `response-${messageId}.wav`;
}
