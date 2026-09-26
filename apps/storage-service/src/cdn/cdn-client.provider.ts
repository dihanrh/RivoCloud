import { Provider } from '@nestjs/common';
import { CdnClient } from './cdn-client.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

export const cdnClientProvider: Provider = {
  provide: CdnClient,
  useFactory: (env: AppEnv) => new CdnClient(env.CDN_SERVICE_URL, env.INTERNAL_API_SECRET),
  inject: [APP_ENV],
};
