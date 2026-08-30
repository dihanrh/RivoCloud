import { Module } from '@nestjs/common';
import { DomainsController } from './domains.controller.js';
import { DomainsService } from './domains.service.js';
import { TraefikConfigPublisher } from './traefik-config.publisher.js';
import { schedulerClientProvider } from './scheduler-client.provider.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [DomainsController],
  providers: [DomainsService, TraefikConfigPublisher, schedulerClientProvider],
})
export class DomainsModule {}
