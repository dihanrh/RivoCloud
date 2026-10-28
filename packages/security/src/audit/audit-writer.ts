import { isIP } from 'node:net';
import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@rivocloud/db';
import type { AuditEntry } from './audit.decorator.js';

export type { AuditEntry } from './audit.decorator.js';

export const SECURITY_PRISMA = Symbol('SECURITY_PRISMA');

// audit_logs is append-only: this class only ever creates rows.
@Injectable()
export class AuditWriter {
  constructor(@Inject(SECURITY_PRISMA) private readonly prisma: PrismaClient) {}

  async write(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        orgId: entry.orgId,
        userId: entry.userId,
        apiKeyId: entry.apiKeyId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        // The column is inet; an unparseable value would fail the insert.
        ipAddress: entry.ipAddress && isIP(entry.ipAddress) !== 0 ? entry.ipAddress : null,
        userAgent: entry.userAgent,
        requestId: entry.requestId,
        metadata: entry.metadata as Prisma.InputJsonValue,
      },
    });
  }
}
