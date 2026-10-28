import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { prisma } from '@rivocloud/db';
import { AppModule } from '../app.module.js';
import { createOrg, joinOrg } from '../test-support/org-fixtures.js';

describe('API Keys', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  beforeEach(async () => {
    await prisma.apiKey.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lets an owner create a full-scope key, shown once, then list only its prefix', async () => {
    const { ownerToken: accessToken } = await createOrg(app, 'keyowner@example.com', 'Key Owner', 'Key Org');

    const create = await request(app.getHttpServer())
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'CI key', permissions: ['cache:invalidate', 'billing:read'] });
    expect(create.status).toBe(201);
    expect(create.body.rawKey.startsWith('rc_live_')).toBe(true);

    const list = await request(app.getHttpServer())
      .get('/api/v1/api-keys')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].keyPrefix).toBe(create.body.keyPrefix);
    expect(list.body[0]).not.toHaveProperty('rawKey');
  });

  it("rejects a developer's request for billing:read (broader than their role)", async () => {
    const owner = await createOrg(app, 'keyowner2@example.com', 'Key Owner2', 'Key Org 2');
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'keydev@example.com', password: 'hunter22222', name: 'Key Dev' });
    await request(app.getHttpServer())
      .post(`/api/v1/orgs/${owner.orgId}/members`)
      .set('Authorization', `Bearer ${owner.ownerToken}`)
      .send({ email: 'keydev@example.com', role: 'developer' });
    const devLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'keydev@example.com', password: 'hunter22222' });
    const devSelectOrg = await request(app.getHttpServer())
      .post('/api/v1/auth/select-org')
      .set('Authorization', `Bearer ${devLogin.body.accessToken}`)
      .send({ orgId: owner.orgId });

    const denied = await request(app.getHttpServer())
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${devSelectOrg.body.accessToken}`)
      .send({ name: 'Sneaky key', permissions: ['billing:read'] });
    expect(denied.status).toBe(403);

    const allowed = await request(app.getHttpServer())
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${devSelectOrg.body.accessToken}`)
      .send({ name: 'Fine key', permissions: ['cache:invalidate'] });
    expect(allowed.status).toBe(201);
  });

  it('revokes a key so it no longer appears in the list', async () => {
    const { ownerToken: accessToken } = await createOrg(app, 'keyowner3@example.com', 'Key Owner3', 'Key Org 3');
    const create = await request(app.getHttpServer())
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Temp key', permissions: ['zone:read'] });

    const revoke = await request(app.getHttpServer())
      .delete(`/api/v1/api-keys/${create.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`);
    expect(revoke.status).toBe(200);

    const list = await request(app.getHttpServer())
      .get('/api/v1/api-keys')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(list.body).toHaveLength(0);
  });

  async function createKey(token: string, name: string) {
    const create = await request(app.getHttpServer())
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, permissions: ['zone:read'] });
    expect(create.status).toBe(201);
    return create.body.id as string;
  }

  it("admin cannot grant scopes beyond the key creator's role", async () => {
    const owner = await createOrg(app, 'capowner@example.com', 'Cap Owner', 'Cap Org');
    const { token: devToken } = await joinOrg(app, owner.orgId, owner.ownerToken, 'capdev@example.com', 'developer');
    const { token: adminToken } = await joinOrg(app, owner.orgId, owner.ownerToken, 'capadmin@example.com', 'admin');
    const devKey = await createKey(devToken, 'dev key');

    const escalate = await request(app.getHttpServer())
      .patch(`/api/v1/api-keys/${devKey}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissions: ['billing:read'] });
    expect(escalate.status).toBe(403);

    const stored = await prisma.apiKey.findUniqueOrThrow({ where: { id: devKey } });
    expect(stored.permissions).toEqual(['zone:read']);

    const withinRole = await request(app.getHttpServer())
      .patch(`/api/v1/api-keys/${devKey}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ permissions: ['cache:invalidate'] });
    expect(withinRole.status).toBe(200);
    expect(withinRole.body).not.toHaveProperty('keyHash');

    const list = await request(app.getHttpServer())
      .get('/api/v1/api-keys')
      .set('Authorization', `Bearer ${adminToken}`);
    const listed = list.body.find((key: { id: string }) => key.id === devKey);
    expect(Object.keys(withinRole.body).sort()).toEqual(Object.keys(listed).sort());
    expect(withinRole.body.permissions).toEqual(['cache:invalidate']);
  });

  it("developer cannot revoke another member's key, admin can, developer can revoke own key", async () => {
    const owner = await createOrg(app, 'revokeowner@example.com', 'Revoke Owner', 'Revoke Org');
    const { token: dev1Token } = await joinOrg(app, owner.orgId, owner.ownerToken, 'revokedev1@example.com', 'developer');
    const { token: dev2Token } = await joinOrg(app, owner.orgId, owner.ownerToken, 'revokedev2@example.com', 'developer');
    const { token: adminToken } = await joinOrg(app, owner.orgId, owner.ownerToken, 'revokeadmin@example.com', 'admin');
    const dev2KeyA = await createKey(dev2Token, 'dev2 key A');
    const dev2KeyB = await createKey(dev2Token, 'dev2 key B');
    const dev1Key = await createKey(dev1Token, 'dev1 key');

    const denied = await request(app.getHttpServer())
      .delete(`/api/v1/api-keys/${dev2KeyA}`)
      .set('Authorization', `Bearer ${dev1Token}`);
    expect(denied.status).toBe(403);

    const deniedUpdate = await request(app.getHttpServer())
      .patch(`/api/v1/api-keys/${dev2KeyA}`)
      .set('Authorization', `Bearer ${dev1Token}`)
      .send({ name: 'renamed by someone else' });
    expect(deniedUpdate.status).toBe(403);

    const byAdmin = await request(app.getHttpServer())
      .delete(`/api/v1/api-keys/${dev2KeyA}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(byAdmin.status).toBe(200);

    const byOwner = await request(app.getHttpServer())
      .delete(`/api/v1/api-keys/${dev2KeyB}`)
      .set('Authorization', `Bearer ${owner.ownerToken}`);
    expect(byOwner.status).toBe(200);

    const own = await request(app.getHttpServer())
      .delete(`/api/v1/api-keys/${dev1Key}`)
      .set('Authorization', `Bearer ${dev1Token}`);
    expect(own.status).toBe(200);
  });
});
