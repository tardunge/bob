import { Module } from '@nestjs/common';
import { OmpService } from './omp.service';

@Module({
  providers: [OmpService],
  exports: [OmpService],
})
export class OmpModule {}
