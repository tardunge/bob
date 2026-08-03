import { Controller, Get } from '@nestjs/common';
import { isOfflineTestMode } from './agent/offline-runtime.service';

@Controller('health')
export class HealthController {
  @Get()
  status() {
    return {
      status: 'ok',
      testMode: isOfflineTestMode() ? 'offline' : null,
    };
  }
}
