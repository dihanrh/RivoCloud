import { Provider } from '@nestjs/common';
import { SchedulerClient } from './scheduler-client.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';

export const schedulerClientProvider: Provider = {
  provide: SchedulerClient,
  useFactory: (env: AppEnv) => new SchedulerClient(env.SCHEDULER_SERVICE_URL, env.INTERNAL_API_SECRET),
  inject: [APP_ENV],
};
