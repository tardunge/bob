import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import {
  VALID_AGENT_HARNESSES,
  getDefaultAgentHarness,
  type AgentHarness,
} from '../agent/agent.types';
import { ModelsService } from './models.service';

@Controller('models')
export class ModelsController {
  constructor(private readonly models: ModelsService) {}

  @Get()
  list(@Query('harness') harness?: string) {
    const selected = harness ?? getDefaultAgentHarness();
    if (!VALID_AGENT_HARNESSES.has(selected as AgentHarness)) {
      throw new BadRequestException(`Unknown harness '${selected}'.`);
    }
    return this.models.listModels(selected as AgentHarness);
  }
}
