import { Module } from '@nestjs/common';
import { InvalidationsController } from './invalidations.controller.js';
import { InvalidationsService } from './invalidations.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [InvalidationsController],
  providers: [InvalidationsService],
})
export class InvalidationsModule {}
