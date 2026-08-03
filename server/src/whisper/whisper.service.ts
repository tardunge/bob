import { Injectable } from '@nestjs/common';
import { join } from 'path';
import { tmpdir } from 'os';
import { readFile, unlink } from 'fs/promises';
import { runProcess } from '../process/process-runner';
import { isOfflineTestMode } from '../agent/offline-runtime.service';

@Injectable()
export class WhisperService {
  private readonly whisperPath =
    process.env.BOB_WHISPER_BINARY || 'whisper-cli';
  private readonly modelPath = process.env.BOB_WHISPER_MODEL_PATH;
  private readonly ffmpegPath = process.env.BOB_FFMPEG_BINARY || 'ffmpeg';

  async transcribe(
    audioFilePath: string,
    initialPrompt?: string | null,
    timeoutMs: number = 60_000,
  ): Promise<string> {
    if (isOfflineTestMode()) {
      return process.env.BOB_TEST_TRANSCRIPT || 'Hello from offline test mode';
    }
    if (!this.modelPath) {
      throw new Error(
        'BOB_WHISPER_MODEL_PATH is required for voice transcription.',
      );
    }
    const outputPath = join(tmpdir(), `bob-transcript-${Date.now()}`);
    let wavPath = audioFilePath;
    const transcriptPath = `${outputPath}.txt`;

    try {
      wavPath = await this.convertToWav(audioFilePath);
      const args = [
        '-f',
        wavPath,
        '-m',
        this.modelPath,
        ...(initialPrompt ? ['--prompt', initialPrompt] : []),
        '-otxt',
        '-of',
        outputPath,
      ];
      await runProcess(this.whisperPath, args, { timeoutMs });
      const transcript = await readFile(transcriptPath, 'utf8');
      return WhisperService.normalizeTranscript(transcript);
    } catch (error) {
      console.error('Whisper transcription error:', error);
      throw new Error(`Failed to transcribe audio: ${error}`);
    } finally {
      await unlink(transcriptPath).catch(() => {});
      if (wavPath !== audioFilePath) await unlink(wavPath).catch(() => {});
    }
  }

  static normalizeTranscript(raw: string): string {
    return raw
      .trim()
      .replace(/^[-—–―]+\s+/, '')
      .replace(/\s+[—–―]+\s+/g, ', ')
      .replace(/[—–―]+/g, ' ')
      .replace(/\s+,/g, ',')
      .replace(/,\s*,/g, ',')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  private async convertToWav(inputPath: string): Promise<string> {
    if (inputPath.endsWith('.wav')) return inputPath;

    const outputPath = join(tmpdir(), `bob-converted-${Date.now()}.wav`);
    try {
      await runProcess(
        this.ffmpegPath,
        [
          '-i',
          inputPath,
          '-ar',
          '16000',
          '-ac',
          '1',
          '-c:a',
          'pcm_s16le',
          outputPath,
          '-y',
        ],
        { timeoutMs: 30_000 },
      );
      return outputPath;
    } catch (error) {
      console.error('Audio conversion error:', error);
      throw new Error(`Failed to convert audio: ${error}`);
    }
  }
}
