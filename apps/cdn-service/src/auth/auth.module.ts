import { Module } from '@nestjs/common';
import { identityClientProvider } from './identity-client.provider.js';
import { AuthGuard } from './auth-guard.js';
import { ZoneScopeGuard } from './zone-scope.guard.js';

@Module({
  providers: [identityClientProvider, AuthGuard, ZoneScopeGuard],
  exports: [AuthGuard, ZoneScopeGuard],
})
export class AuthModule {}
