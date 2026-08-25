import { Module } from '@nestjs/common';
import { BucketsController } from './buckets.controller.js';
import { BucketsService } from './buckets.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [BucketsController],
  providers: [BucketsService],
  exports: [BucketsService],
})
export class BucketsModule {}
