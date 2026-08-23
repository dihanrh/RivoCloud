import { Provider } from '@nestjs/common';
import { IdentityClient } from './identity-client.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

export const identityClientProvider: Provider = {
  provide: IdentityClient,
  useFactory: (env: AppEnv) => new IdentityClient(env.IDENTITY_SERVICE_URL, env.INTERNAL_API_SECRET),
  inject: [APP_ENV],
};
