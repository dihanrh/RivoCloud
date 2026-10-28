import { randomUUID } from 'node:crypto';
import { prisma } from '@rivocloud/db';
import { afterAll, describe, expect, it } from 'vitest';
import { AuditWriter, type AuditEntry } from './audit-writer.js';

describe('AuditWriter (Postgres)', () => {
  const writer = new AuditWriter(prisma);
  const ids: bigint[] = [];

  const writeAndRead = async (over: Partial<AuditEntry> = {}) => {
    const requestId = randomUUID();
    await writer.write({
      orgId: null,
      userId: null,
      apiKeyId: null,
      action: 'test.audit',
      resourceType: 'test',
      resourceId: 'r1',
      ipAddress: '203.0.113.9',
      userAgent: 'UA',
      requestId,
      metadata: { params: { a: 'b' } },
      ...over,
    });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { requestId: over.requestId ?? requestId } });
    ids.push(row.id);
    return row;
  };

  afterAll(async () => {
    // Test cleanup only: remove the rows this test created.
    await prisma.auditLog.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  });

  it('writes a row and reads it back', async () => {
    const row = await writeAndRead();
    expect(row).toMatchObject({
      action: 'test.audit',
      resourceType: 'test',
      resourceId: 'r1',
      userAgent: 'UA',
      metadata: { params: { a: 'b' } },
    });
    expect(row.ipAddress).toBe('203.0.113.9');
  });

  it('stores an invalid ipAddress as null', async () => {
    const row = await writeAndRead({ ipAddress: 'not-an-ip' });
    expect(row.ipAddress).toBeNull();
  });

  it('round-trips an IPv4-mapped IPv6 address', async () => {
    const row = await writeAndRead({ ipAddress: '::ffff:127.0.0.1' });
    expect(row.ipAddress).toContain('127.0.0.1');
  });
});
