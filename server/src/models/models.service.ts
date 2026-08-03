import { Injectable } from '@nestjs/common';
import type { AgentHarness } from '../agent/agent.types';
import { getModelOptions } from './model-catalog';

@Injectable()
export class ModelsService {
  listModels(harness: AgentHarness) {
    return getModelOptions(harness);
  }
}
