import { Module } from '@nestjs/common';
import { VoiceModule } from './voice/voice.module';
import { DatabaseModule } from './database/database.module';
import { SessionModule } from './session/session.module';
import { SkillsModule } from './skills/skills.module';
import { JobsModule } from './jobs/jobs.module';
import { AudioModule } from './audio/audio.module';
import { MemoryModule } from './memory/memory.module';
import { ModelsModule } from './models/models.module';
import { ProfilesController } from './profiles.controller';
import { HealthController } from './health.controller';

@Module({
  imports: [
    DatabaseModule,
    SessionModule,
    VoiceModule,
    SkillsModule,
    JobsModule,
    AudioModule,
    MemoryModule,
    ModelsModule,
  ],
  controllers: [ProfilesController, HealthController],
})
export class AppModule {}
