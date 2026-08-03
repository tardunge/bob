import {
  Controller,
  Post,
  Get,
  UseInterceptors,
  UploadedFile,
  Body,
  Param,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { VoiceService } from './voice.service';
import { JobsService } from '../jobs/jobs.service';
import { SessionService } from '../session/session.service';
import {
  VALID_EFFORT_LEVELS,
  type EffortLevel,
} from '../claude/claude.service';
import { diskStorage } from 'multer';
import { extname, join, basename } from 'path';
import { tmpdir } from 'os';
import { existsSync } from 'fs';
import { AUDIO_DIR } from '../audio/audio.constants';
import {
  VALID_AGENT_HARNESSES,
  type AgentHarness,
} from '../agent/agent.types';
import { isValidModelForHarness } from '../models/model-catalog';

@Controller('voice')
export class VoiceController {
  constructor(
    private readonly voiceService: VoiceService,
    private readonly jobsService: JobsService,
    private readonly sessionService: SessionService,
  ) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: diskStorage({
        destination: tmpdir(),
        filename: (req, file, cb) => {
          const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
          cb(null, `bob-input-${uniqueSuffix}${extname(file.originalname) || '.webm'}`);
        },
      }),
    }),
  )
  acceptVoice(
    @UploadedFile() file: Express.Multer.File,
    @Body('sessionId') sessionId: string | undefined,
    @Body('skill') skill: string | undefined,
    @Body('effort') effort: string | undefined,
    @Body('model') model: string | undefined,
    @Body('harness') harness: string | undefined,
  ) {
    if (!file) {
      throw new HttpException('No audio file provided', HttpStatus.BAD_REQUEST);
    }
    if (!sessionId) {
      throw new HttpException(
        'sessionId is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!harness || !VALID_AGENT_HARNESSES.has(harness as AgentHarness)) {
      throw new HttpException(
        `harness is required and must be one of: ${[...VALID_AGENT_HARNESSES].join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const agentHarness = harness as AgentHarness;

    // Whitelist effort so it's safe to interpolate into the claude shell command.
    let effortLevel: EffortLevel | undefined;
    if (effort) {
      if (!VALID_EFFORT_LEVELS.has(effort as EffortLevel)) {
        throw new HttpException(
          `Invalid effort '${effort}'. Allowed: ${[...VALID_EFFORT_LEVELS].join(', ')}`,
          HttpStatus.BAD_REQUEST,
        );
      }
      effortLevel = effort as EffortLevel;
    }

    // Validate a harness-specific model id. Empty selection stays undefined so
    // the selected harness uses its configured default model.
    let modelName: string | undefined;
    if (model) {
      if (!isValidModelForHarness(agentHarness, model)) {
        throw new HttpException(
          `Invalid model '${model}' for harness '${agentHarness}'.`,
          HttpStatus.BAD_REQUEST,
        );
      }
      modelName = model;
    }

    const session = this.sessionService.getSession(sessionId);
    if (!session) {
      throw new HttpException('Session not found', HttpStatus.NOT_FOUND);
    }

    if (session.agent_harness !== agentHarness) {
      throw new HttpException(
        `Harness mismatch: session uses '${session.agent_harness}', request uses '${agentHarness}'.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    if (this.jobsService.isProcessing(sessionId)) {
      throw new HttpException(
        'A response is already being generated for this session.',
        HttpStatus.CONFLICT,
      );
    }

    // Mark in-flight and emit `processing` before we return — the client's SSE
    // stream will see it almost immediately.
    const jobId = this.jobsService.start(sessionId, agentHarness);
    this.voiceService.processInBackground(
      file.path,
      sessionId,
      agentHarness,
      skill,
      effortLevel,
      modelName,
    );

    return { sessionId, jobId, harness: agentHarness, accepted: true };
  }

  @Get('/audio/:filename')
  async getAudio(@Param('filename') filename: string, @Res() res: Response) {
    // Sanitize filename to prevent path traversal
    const sanitizedFilename = basename(filename);
    const audioPath = join(AUDIO_DIR, sanitizedFilename);

    if (!existsSync(audioPath)) {
      throw new HttpException('Audio file not found', HttpStatus.NOT_FOUND);
    }

    res.setHeader('Content-Type', 'audio/wav');
    res.sendFile(audioPath);
  }
}
