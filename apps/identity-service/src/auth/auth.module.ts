import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { tokenServiceProvider } from './token.service.provider.js';
import { TokenService } from './token.service.js';
import { EventsModule } from '../events/events.module.js';
import { JwtOnlyGuard } from './jwt-only.guard.js';

@Module({
  imports: [EventsModule],
  controllers: [AuthController],
  providers: [AuthService, tokenServiceProvider, JwtOnlyGuard],
  exports: [TokenService, JwtOnlyGuard, AuthService],
})
export class AuthModule {}
