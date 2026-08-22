import { Module } from '@nestjs/common';
import { identityClientProvider } from './identity-client.provider.js';
import { AuthGuard } from './auth-guard.js';

@Module({
  providers: [identityClientProvider, AuthGuard],
  exports: [AuthGuard],
})
export class AuthModule {}
