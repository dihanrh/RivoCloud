import { Module } from '@nestjs/common';
import { ObjectsController } from './objects.controller.js';
import { ObjectsService } from './objects.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { BucketsModule } from '../buckets/buckets.module.js';

@Module({
  imports: [AuthModule, BucketsModule],
  controllers: [ObjectsController],
  providers: [ObjectsService],
})
export class ObjectsModule {}
