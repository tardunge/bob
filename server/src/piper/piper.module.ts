import { Module } from '@nestjs/common';
import { PiperService } from './piper.service';

@Module({
  providers: [PiperService],
  exports: [PiperService],
})
export class PiperModule {}
