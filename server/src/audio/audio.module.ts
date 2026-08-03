import { Module } from '@nestjs/common';
import { AudioCleanupService } from './audio-cleanup.service';

@Module({
  providers: [AudioCleanupService],
  exports: [AudioCleanupService],
})
export class AudioModule {}
