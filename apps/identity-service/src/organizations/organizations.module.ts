import { Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';
import { RolesGuard } from './roles.guard.js';
import { AuthModule } from '../auth/auth.module.js';
import { EventsModule } from '../events/events.module.js';

@Module({
  imports: [AuthModule, EventsModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, RolesGuard],
})
export class OrganizationsModule {}
