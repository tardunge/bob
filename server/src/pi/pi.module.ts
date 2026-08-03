import { Module } from '@nestjs/common';
import { PiRpcService } from './pi-rpc.service';

@Module({
  providers: [PiRpcService],
  exports: [PiRpcService],
})
export class PiModule {}
