import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { AgentWorkService } from './agent-work.service';

@Controller('agent-work')
export class AgentWorkController {
  constructor(private readonly agentWork: AgentWorkService) {}

  @Get('terminal-sequence')
  terminalSequence() {
    return { terminalSequence: this.agentWork.maxTerminalSequence() };
  }

  @Get()
  list(
    @Query('sessionId') sessionId?: string,
    @Query('after') after?: string,
  ) {
    if (sessionId) return this.agentWork.listForSession(sessionId);
    const sequence = after === undefined ? 0 : Number(after);
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw new BadRequestException('after must be a non-negative integer');
    }
    return this.agentWork.listTerminalAfter(sequence);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.agentWork.cancel(id);
  }
}
