import { forwardRef, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { tokenServiceProvider } from './token.service.provider.js';
import { TokenService } from './token.service.js';
import { EventsModule } from '../events/events.module.js';
import { JwtOnlyGuard } from './jwt-only.guard.js';
import { AuthGuard } from './auth-guard.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';

@Module({
  imports: [EventsModule, forwardRef(() => ApiKeysModule)],
  controllers: [AuthController],
  providers: [AuthService, tokenServiceProvider, JwtOnlyGuard, AuthGuard],
  exports: [TokenService, JwtOnlyGuard, AuthService, AuthGuard],
})
export class AuthModule {}
