import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { SessionModule } from '../session/session.module';
import { AgentWorkController } from './agent-work.controller';
import { AgentWorkService } from './agent-work.service';

@Module({
  imports: [AgentModule, SessionModule],
  controllers: [AgentWorkController],
  providers: [AgentWorkService],
  exports: [AgentWorkService],
})
export class AgentWorkModule {}
