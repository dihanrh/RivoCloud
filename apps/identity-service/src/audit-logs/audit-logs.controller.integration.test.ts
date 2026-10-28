import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { prisma } from '@rivocloud/db';
import { AppModule } from '../app.module.js';
import { createOrg, joinOrg, orgWithDeveloper, registerAndLogin, TEST_PASSWORD } from '../test-support/org-fixtures.js';

describe('Audit logs', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  beforeEach(async () => {
    // Test-only cleanup so pagination and lookups are deterministic.
    await prisma.auditLog.deleteMany();
    await prisma.apiKey.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  const readLogs = (orgId: string, token: string, query = '') =>
    request(app.getHttpServer())
      .get(`/api/v1/orgs/${orgId}/audit-logs${query}`)
      .set('Authorization', `Bearer ${token}`);

  it('inviting a member writes member.added with actor and metadata', async () => {
    const { orgId, ownerToken } = await createOrg(app, 'auditowner@example.com', 'Audit Owner', 'Audit Org');
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'auditowner@example.com' } });
    const { userId: devId } = await joinOrg(app, orgId, ownerToken, 'auditdev@example.com', 'developer');

    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'member.added' } });
    expect(row).toMatchObject({
      userId: owner.id,
      orgId,
      resourceType: 'member',
      resourceId: devId,
    });
    expect((row.metadata as { body: unknown }).body).toEqual({ email: 'auditdev@example.com', role: 'developer' });
  });

  it('password change audit row has no password fields', async () => {
    const token = await registerAndLogin(app, 'auditpw@example.com', 'Audit Pw');
    const newPassword = 'correct-horse-battery';
    const change = await request(app.getHttpServer())
      .patch('/api/v1/users/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword });
    expect(change.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'auditpw@example.com' } });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.password_changed' } });
    expect(row.userId).toBe(user.id);
    expect(row.resourceType).toBe('user');
    const metadata = JSON.stringify(row.metadata);
    for (const forbidden of ['currentPassword', 'newPassword', TEST_PASSWORD, newPassword]) {
      expect(metadata).not.toContain(forbidden);
    }
  });

  it('owner and admin can read; developer gets 403', async () => {
    const { orgId, ownerToken, devToken } = await orgWithDeveloper(app, 'auditroles');
    const { token: adminToken } = await joinOrg(app, orgId, ownerToken, 'auditrolesadmin@example.com', 'admin');

    const byOwner = await readLogs(orgId, ownerToken);
    expect(byOwner.status).toBe(200);
    expect(byOwner.body.items.length).toBeGreaterThan(0);
    const entry = byOwner.body.items.find((item: { action: string }) => item.action === 'member.added');
    expect(entry).toMatchObject({
      action: 'member.added',
      resourceType: 'member',
      user: { email: 'auditrolesowner@example.com', name: 'Owner' },
      apiKey: null,
    });
    expect(typeof entry.id).toBe('string');
    expect(typeof entry.createdAt).toBe('string');

    const byAdmin = await readLogs(orgId, adminToken);
    expect(byAdmin.status).toBe(200);

    const byDev = await readLogs(orgId, devToken);
    expect(byDev.status).toBe(403);
  });

  it('audit logs are org-scoped', async () => {
    const orgA = await createOrg(app, 'scopea@example.com', 'Owner A', 'Scope Org A');
    const orgB = await createOrg(app, 'scopeb@example.com', 'Owner B', 'Scope Org B');

    const crossOrg = await readLogs(orgA.orgId, orgB.ownerToken);
    expect(crossOrg.status).toBe(404);

    const own = await readLogs(orgB.orgId, orgB.ownerToken);
    expect(own.status).toBe(200);
    expect(own.body.items.every((item: { action: string }) => item.action === 'org.created')).toBe(true);
    expect(own.body.items).toHaveLength(1);
  });

  it('paginates with cursor', async () => {
    const { orgId, ownerToken } = await createOrg(app, 'pageowner@example.com', 'Page Owner', 'Page Org');
    // org.created, then two renames: three entries for this org.
    for (const name of ['Page Org 2', 'Page Org 3']) {
      const rename = await request(app.getHttpServer())
        .patch(`/api/v1/orgs/${orgId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name });
      expect(rename.status).toBe(200);
    }

    const first = await readLogs(orgId, ownerToken, '?limit=2');
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.items.map((item: { action: string }) => item.action)).toEqual(['org.updated', 'org.updated']);
    expect(first.body.items[0].metadata.body).toEqual({ name: 'Page Org 3' });
    expect(first.body.nextCursor).toBe(first.body.items[1].id);
    expect(BigInt(first.body.items[0].id)).toBeGreaterThan(BigInt(first.body.items[1].id));

    const second = await readLogs(orgId, ownerToken, `?limit=2&cursor=${first.body.nextCursor}`);
    expect(second.status).toBe(200);
    expect(second.body.items).toHaveLength(1);
    expect(second.body.items[0].action).toBe('org.created');
    expect(second.body.nextCursor).toBeNull();
  });

  it('rejects an invalid cursor or limit', async () => {
    const { orgId, ownerToken } = await createOrg(app, 'badq@example.com', 'Bad Query', 'Bad Query Org');
    expect((await readLogs(orgId, ownerToken, '?cursor=abc')).status).toBe(400);
    expect((await readLogs(orgId, ownerToken, '?limit=0')).status).toBe(400);
    expect((await readLogs(orgId, ownerToken, '?limit=101')).status).toBe(400);
  });

  it('creating an org records the new org id', async () => {
    const { orgId } = await createOrg(app, 'neworg@example.com', 'New Org Owner', 'Brand New Org');
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'neworg@example.com' } });

    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: 'org.created' } });
    expect(row).toMatchObject({
      orgId,
      userId: owner.id,
      resourceType: 'organization',
      resourceId: orgId,
    });
  });
});
