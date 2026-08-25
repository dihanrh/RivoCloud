import { Module } from '@nestjs/common';
import { identityClientProvider } from './identity-client.provider.js';
import { IdentityClient } from './identity-client.js';
import { AuthGuard } from './auth-guard.js';
import { StorageScopeGuard } from './storage-scope.guard.js';

@Module({
  providers: [identityClientProvider, AuthGuard, StorageScopeGuard],
  exports: [IdentityClient, AuthGuard, StorageScopeGuard],
})
export class AuthModule {}
