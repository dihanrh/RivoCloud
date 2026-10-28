import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { prisma } from '@rivocloud/db';
import { AppModule } from '../app.module.js';
import { createOrg, joinOrg, registerAndLogin } from '../test-support/org-fixtures.js';

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

  it('cross-org access returns 404', async () => {
    const orgA = await createOrg(app, 'ownera@example.com', 'Owner A', 'Org A');
    const orgB = await createOrg(app, 'ownerb@example.com', 'Owner B', 'Org B');
    const devA = await joinOrg(app, orgA.orgId, orgA.ownerToken, 'deva@example.com', 'developer');
    await registerAndLogin(app, 'stranger@example.com', 'Stranger');
    const server = app.getHttpServer();
    const auth = `Bearer ${orgB.ownerToken}`;

    expect((await request(server).get(`/api/v1/orgs/${orgA.orgId}`).set('Authorization', auth)).status).toBe(404);
    expect((await request(server).get(`/api/v1/orgs/${orgA.orgId}/members`).set('Authorization', auth)).status).toBe(404);
    const invite = await request(server)
      .post(`/api/v1/orgs/${orgA.orgId}/members`)
      .set('Authorization', auth)
      .send({ email: 'stranger@example.com', role: 'viewer' });
    expect(invite.status).toBe(404);
    const change = await request(server)
      .patch(`/api/v1/orgs/${orgA.orgId}/members/${devA.userId}`)
      .set('Authorization', auth)
      .send({ role: 'viewer' });
    expect(change.status).toBe(404);
    const remove = await request(server)
      .delete(`/api/v1/orgs/${orgA.orgId}/members/${devA.userId}`)
      .set('Authorization', auth);
    expect(remove.status).toBe(404);
    const rename = await request(server).patch(`/api/v1/orgs/${orgA.orgId}`).set('Authorization', auth).send({ name: 'Hijacked' });
    expect(rename.status).toBe(404);
    expect((await request(server).delete(`/api/v1/orgs/${orgA.orgId}`).set('Authorization', auth)).status).toBe(404);

    const members = await prisma.organizationMember.findMany({ where: { orgId: orgA.orgId } });
    expect(members.map((m) => m.role).sort()).toEqual(['developer', 'owner']);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: orgA.orgId } })).name).toBe('Org A');
  });

  it('members list hides password hashes', async () => {
    const org = await createOrg(app, 'hashowner@example.com', 'Hash Owner', 'Hash Org');
    await joinOrg(app, org.orgId, org.ownerToken, 'hashdev@example.com', 'developer');

    const members = await request(app.getHttpServer())
      .get(`/api/v1/orgs/${org.orgId}/members`)
      .set('Authorization', `Bearer ${org.ownerToken}`);
    expect(members.status).toBe(200);
    expect(members.body).toHaveLength(2);
    for (const member of members.body) {
      expect(Object.keys(member).sort()).toEqual(['joinedAt', 'role', 'user', 'userId']);
      expect(Object.keys(member.user).sort()).toEqual(['email', 'id', 'name']);
    }
    expect(JSON.stringify(members.body)).not.toContain('passwordHash');
  });

  it('nobody can assign the owner role', async () => {
    const org = await createOrg(app, 'ownerrole@example.com', 'Owner Role', 'Owner Role Org');
    const dev = await joinOrg(app, org.orgId, org.ownerToken, 'ownerroledev@example.com', 'developer');
    await registerAndLogin(app, 'wannabe@example.com', 'Wannabe');

    const invite = await request(app.getHttpServer())
      .post(`/api/v1/orgs/${org.orgId}/members`)
      .set('Authorization', `Bearer ${org.ownerToken}`)
      .send({ email: 'wannabe@example.com', role: 'owner' });
    expect(invite.status).toBe(400);

    const promote = await request(app.getHttpServer())
      .patch(`/api/v1/orgs/${org.orgId}/members/${dev.userId}`)
      .set('Authorization', `Bearer ${org.ownerToken}`)
      .send({ role: 'owner' });
    expect(promote.status).toBe(400);
  });

  it('admin can invite developer but not admin', async () => {
    const org = await createOrg(app, 'inviteowner@example.com', 'Invite Owner', 'Invite Org');
    const admin = await joinOrg(app, org.orgId, org.ownerToken, 'inviteadmin@example.com', 'admin');
    await registerAndLogin(app, 'newdev@example.com', 'New Dev');
    await registerAndLogin(app, 'newadmin@example.com', 'New Admin');

    const dev = await request(app.getHttpServer())
      .post(`/api/v1/orgs/${org.orgId}/members`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ email: 'newdev@example.com', role: 'developer' });
    expect(dev.status).toBe(201);

    const anotherAdmin = await request(app.getHttpServer())
      .post(`/api/v1/orgs/${org.orgId}/members`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ email: 'newadmin@example.com', role: 'admin' });
    expect(anotherAdmin.status).toBe(403);
  });

  it('admin cannot remove another admin', async () => {
    const org = await createOrg(app, 'removeowner@example.com', 'Remove Owner', 'Remove Org');
    const admin1 = await joinOrg(app, org.orgId, org.ownerToken, 'admin1@example.com', 'admin');
    const admin2 = await joinOrg(app, org.orgId, org.ownerToken, 'admin2@example.com', 'admin');
    const dev = await joinOrg(app, org.orgId, org.ownerToken, 'removedev@example.com', 'developer');

    const removeAdmin = await request(app.getHttpServer())
      .delete(`/api/v1/orgs/${org.orgId}/members/${admin2.userId}`)
      .set('Authorization', `Bearer ${admin1.token}`);
    expect(removeAdmin.status).toBe(403);

    const removeDev = await request(app.getHttpServer())
      .delete(`/api/v1/orgs/${org.orgId}/members/${dev.userId}`)
      .set('Authorization', `Bearer ${admin1.token}`);
    expect(removeDev.status).toBe(200);
  });

  it('only owner can change roles', async () => {
    const org = await createOrg(app, 'changeowner@example.com', 'Change Owner', 'Change Org');
    const admin = await joinOrg(app, org.orgId, org.ownerToken, 'changeadmin@example.com', 'admin');
    const dev = await joinOrg(app, org.orgId, org.ownerToken, 'changedev@example.com', 'developer');

    const asAdmin = await request(app.getHttpServer())
      .patch(`/api/v1/orgs/${org.orgId}/members/${dev.userId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ role: 'viewer' });
    expect(asAdmin.status).toBe(403);

    const asOwner = await request(app.getHttpServer())
      .patch(`/api/v1/orgs/${org.orgId}/members/${dev.userId}`)
      .set('Authorization', `Bearer ${org.ownerToken}`)
      .send({ role: 'viewer' });
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.role).toBe('viewer');
  });

  it('applies a demotion immediately, without waiting for the JWT to expire', async () => {
    const org = await createOrg(app, 'liveowner@example.com', 'Live Owner', 'Live Org');
    const admin = await joinOrg(app, org.orgId, org.ownerToken, 'liveadmin@example.com', 'admin');
    await registerAndLogin(app, 'liveinvitee@example.com', 'Live Invitee');

    await request(app.getHttpServer())
      .patch(`/api/v1/orgs/${org.orgId}/members/${admin.userId}`)
      .set('Authorization', `Bearer ${org.ownerToken}`)
      .send({ role: 'viewer' });

    const staleAdmin = await request(app.getHttpServer())
      .post(`/api/v1/orgs/${org.orgId}/members`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ email: 'liveinvitee@example.com', role: 'viewer' });
    expect(staleAdmin.status).toBe(403);
  });
});
