import { Module } from '@nestjs/common';
import { identityClientProvider } from './identity-client.provider.js';
import { IdentityClient } from './identity-client.js';
import { AuthGuard } from './auth-guard.js';
import { AnalyticsAccessGuard } from './analytics-access.guard.js';

@Module({
  providers: [identityClientProvider, AuthGuard, AnalyticsAccessGuard],
  exports: [IdentityClient, AuthGuard, AnalyticsAccessGuard],
})
export class AuthModule {}
