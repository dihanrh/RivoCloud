import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { prisma } from '@rivocloud/db';
import { AppModule } from '../app.module.js';

async function registerAndLogin(app: INestApplication, email: string, name: string) {
  await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email, password: 'hunter22222', name });
  const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'hunter22222' });
  return login.body.accessToken as string;
}

describe('Organizations + Members', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  beforeEach(async () => {
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates an org, minting owner-scoped tokens, then invites a developer', async () => {
    const ownerToken = await registerAndLogin(app, 'owner@example.com', 'Owner');
    const create = await request(app.getHttpServer())
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Acme Corp' });
    expect(create.status).toBe(201);
    expect(create.body.organization.slug).toBe('acme-corp');
    const orgOwnerToken = create.body.accessToken as string;

    await registerAndLogin(app, 'dev@example.com', 'Dev');
    const invite = await request(app.getHttpServer())
      .post(`/api/v1/orgs/${create.body.organization.id}/members`)
      .set('Authorization', `Bearer ${orgOwnerToken}`)
      .send({ email: 'dev@example.com', role: 'developer' });
    expect(invite.status).toBe(201);
    expect(invite.body.role).toBe('developer');

    const members = await request(app.getHttpServer())
      .get(`/api/v1/orgs/${create.body.organization.id}/members`)
      .set('Authorization', `Bearer ${orgOwnerToken}`);
    expect(members.status).toBe(200);
    expect(members.body).toHaveLength(2);
  });

  it('blocks a developer from adding members but allows an admin', async () => {
    const ownerToken = await registerAndLogin(app, 'owner2@example.com', 'Owner2');
    const create = await request(app.getHttpServer())
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Widgets Inc' });
    const orgId = create.body.organization.id;
    const orgOwnerToken = create.body.accessToken as string;

    await registerAndLogin(app, 'dev2@example.com', 'Dev2');
    await request(app.getHttpServer())
      .post(`/api/v1/orgs/${orgId}/members`)
      .set('Authorization', `Bearer ${orgOwnerToken}`)
      .send({ email: 'dev2@example.com', role: 'developer' });

    const devLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'dev2@example.com', password: 'hunter22222' });
    const selectOrg = await request(app.getHttpServer())
      .post('/api/v1/auth/select-org')
      .set('Authorization', `Bearer ${devLogin.body.accessToken}`)
      .send({ orgId });
    const devOrgToken = selectOrg.body.accessToken as string;

    await registerAndLogin(app, 'viewer@example.com', 'Viewer');
    const blocked = await request(app.getHttpServer())
      .post(`/api/v1/orgs/${orgId}/members`)
      .set('Authorization', `Bearer ${devOrgToken}`)
      .send({ email: 'viewer@example.com', role: 'viewer' });
    expect(blocked.status).toBe(403);

    const allowed = await request(app.getHttpServer())
      .post(`/api/v1/orgs/${orgId}/members`)
      .set('Authorization', `Bearer ${orgOwnerToken}`)
      .send({ email: 'viewer@example.com', role: 'viewer' });
    expect(allowed.status).toBe(201);
  });

  it('rejects removing the owner and prevents a developer from deleting the org', async () => {
    const ownerToken = await registerAndLogin(app, 'owner3@example.com', 'Owner3');
    const create = await request(app.getHttpServer())
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Gadgets Co' });
    const orgId = create.body.organization.id;
    const orgOwnerToken = create.body.accessToken as string;
    const ownerUserId = (await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })).ownerId;

    const removeOwner = await request(app.getHttpServer())
      .delete(`/api/v1/orgs/${orgId}/members/${ownerUserId}`)
      .set('Authorization', `Bearer ${orgOwnerToken}`);
    expect(removeOwner.status).toBe(403);

    await registerAndLogin(app, 'dev3@example.com', 'Dev3');
    await request(app.getHttpServer())
      .post(`/api/v1/orgs/${orgId}/members`)
      .set('Authorization', `Bearer ${orgOwnerToken}`)
      .send({ email: 'dev3@example.com', role: 'developer' });
    const devLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'dev3@example.com', password: 'hunter22222' });
    const devSelectOrg = await request(app.getHttpServer())
      .post('/api/v1/auth/select-org')
      .set('Authorization', `Bearer ${devLogin.body.accessToken}`)
      .send({ orgId });

    const deleteAsDeveloper = await request(app.getHttpServer())
      .delete(`/api/v1/orgs/${orgId}`)
      .set('Authorization', `Bearer ${devSelectOrg.body.accessToken}`);
    expect(deleteAsDeveloper.status).toBe(403);
  });
});
