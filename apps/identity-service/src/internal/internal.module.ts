import { Module } from '@nestjs/common';
import { InternalController } from './internal.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';

@Module({
  imports: [AuthModule, ApiKeysModule],
  controllers: [InternalController],
})
export class InternalModule {}
