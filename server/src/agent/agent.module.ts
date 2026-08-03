import { Module } from '@nestjs/common';
import { ClaudeModule } from '../claude/claude.module';
import { PiModule } from '../pi/pi.module';
import { AgentRuntimeService } from './agent-runtime.service';
import { OfflineRuntimeService } from './offline-runtime.service';

@Module({
  imports: [ClaudeModule, PiModule],
  providers: [AgentRuntimeService, OfflineRuntimeService],
  exports: [AgentRuntimeService],
})
export class AgentModule {}
