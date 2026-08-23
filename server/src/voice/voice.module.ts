import { Module } from '@nestjs/common';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';
import { WhisperModule } from '../whisper/whisper.module';
import { AgentModule } from '../agent/agent.module';
import { PiperModule } from '../piper/piper.module';
import { SessionModule } from '../session/session.module';
import { JobsModule } from '../jobs/jobs.module';
import { AgentWorkModule } from '../agent-work/agent-work.module';

@Module({
  imports: [
    WhisperModule,
    AgentModule,
    AgentWorkModule,
    PiperModule,
    SessionModule,
    JobsModule,
  ],
  controllers: [VoiceController],
  providers: [VoiceService],
})
export class VoiceModule {}
