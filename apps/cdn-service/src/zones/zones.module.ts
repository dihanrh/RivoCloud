import { Module } from '@nestjs/common';
import { ZonesController } from './zones.controller.js';
import { ZonesService } from './zones.service.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [ZonesController],
  providers: [ZonesService],
})
export class ZonesModule {}
