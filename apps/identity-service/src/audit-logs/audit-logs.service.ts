import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@rivocloud/db';
import { PRISMA } from '../prisma/prisma.module.js';

export interface AuditLogEntry {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: string;
  user: { id: string; email: string; name: string } | null;
  apiKey: { id: string; name: string; keyPrefix: string } | null;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  nextCursor: string | null;
}

@Injectable()
export class AuditLogsService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  /** Newest first (by id); `cursor` returns entries with a smaller id. */
  async list(orgId: string, limit: number, cursor?: string): Promise<AuditLogPage> {
    const rows = await this.db.auditLog.findMany({
      where: { orgId, ...(cursor ? { id: { lt: BigInt(cursor) } } : {}) },
      orderBy: { id: 'desc' },
      take: limit,
      include: {
        user: { select: { id: true, email: true, name: true } },
        apiKey: { select: { id: true, name: true, keyPrefix: true } },
      },
    });
    const items = rows.map(
      (row): AuditLogEntry => ({
        id: row.id.toString(),
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        metadata: row.metadata,
        createdAt: row.createdAt.toISOString(),
        user: row.user,
        apiKey: row.apiKey,
      }),
    );
    const last = items[items.length - 1];
    return { items, nextCursor: items.length === limit && last ? last.id : null };
  }
}
