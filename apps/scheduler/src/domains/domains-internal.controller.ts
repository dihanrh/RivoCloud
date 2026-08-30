import { Controller, Inject, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import type { PrismaClient } from '@rivocloud/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { InternalAuthGuard } from './internal-auth.guard.js';
import { DomainVerificationService } from './domain-verification.service.js';

@Controller('internal/domains')
@UseGuards(InternalAuthGuard)
export class DomainsInternalController {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly verification: DomainVerificationService,
  ) {}

  @Post(':domainId/verify-now')
  async verifyNow(@Param('domainId') domainId: string) {
    const domain = await this.db.zoneDomain.findUnique({ where: { id: domainId } });
    if (!domain) {
      throw new NotFoundException('Domain not found');
    }
    return this.verification.checkOne(domain);
  }
}
