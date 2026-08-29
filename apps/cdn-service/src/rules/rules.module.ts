import { Module } from '@nestjs/common';
import { RulesController } from './rules.controller.js';
import { RulesService } from './rules.service.js';
import { RulesConfigPublisher } from './rules-config.publisher.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [RulesController],
  providers: [RulesService, RulesConfigPublisher],
})
export class RulesModule {}
