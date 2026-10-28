import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { prisma } from '@rivocloud/db';
import { AppModule } from '../app.module.js';
import { loadEnv } from '../env.js';

describe('Internal auth verification endpoints', () => {
  let app: INestApplication;
  const internalSecret = loadEnv().INTERNAL_API_SECRET;

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

  it('rejects internal calls without the shared secret', async () => {
    const response = await request(app.getHttpServer())
      .post('/internal/auth/verify-token')
      .send({ token: 'whatever' });
    expect(response.status).toBe(401);
  });

  it('verifies a real access token when the shared secret is present', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'internal@example.com', password: 'hunter22222', name: 'Internal' });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'internal@example.com', password: 'hunter22222' });

    const verify = await request(app.getHttpServer())
      .post('/internal/auth/verify-token')
      .set('X-Internal-Secret', internalSecret)
      .send({ token: login.body.accessToken });
    expect(verify.status).toBe(201);
    expect(verify.body.userId).toBeDefined();
  });

  it('verifies a real API key when the shared secret is present', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'internalowner@example.com', password: 'hunter22222', name: 'Internal Owner' });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'internalowner@example.com', password: 'hunter22222' });
    const org = await request(app.getHttpServer())
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ name: 'Internal Org' });
    const key = await request(app.getHttpServer())
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${org.body.accessToken}`)
      .send({ name: 'Internal test key', permissions: ['zone:read'] });

    const verify = await request(app.getHttpServer())
      .post('/internal/auth/verify-api-key')
      .set('X-Internal-Secret', internalSecret)
      .send({ apiKey: key.body.rawKey });
    expect(verify.status).toBe(201);
    expect(verify.body.permissions).toEqual(['zone:read']);
  });

  async function orgWithDeveloper(prefix: string) {
    const server = app.getHttpServer();
    await request(server)
      .post('/api/v1/auth/register')
      .send({ email: `${prefix}owner@example.com`, password: 'hunter22222', name: 'Owner' });
    const ownerLogin = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: `${prefix}owner@example.com`, password: 'hunter22222' });
    const org = await request(server)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${ownerLogin.body.accessToken}`)
      .send({ name: `${prefix} Org` });
    const orgId = org.body.organization.id as string;
    const ownerToken = org.body.accessToken as string;

    await request(server)
      .post('/api/v1/auth/register')
      .send({ email: `${prefix}dev@example.com`, password: 'hunter22222', name: 'Dev' });
    const invite = await request(server)
      .post(`/api/v1/orgs/${orgId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: `${prefix}dev@example.com`, role: 'developer' });
    const devLogin = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: `${prefix}dev@example.com`, password: 'hunter22222' });
    const devSelect = await request(server)
      .post('/api/v1/auth/select-org')
      .set('Authorization', `Bearer ${devLogin.body.accessToken}`)
      .send({ orgId });
    return {
      orgId,
      ownerToken,
      devUserId: invite.body.userId as string,
      devToken: devSelect.body.accessToken as string,
    };
  }

  it('verify-token returns the live role', async () => {
    const { orgId, ownerToken, devUserId, devToken } = await orgWithDeveloper('liverole');
    await request(app.getHttpServer())
      .patch(`/api/v1/orgs/${orgId}/members/${devUserId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'viewer' });

    const verify = await request(app.getHttpServer())
      .post('/internal/auth/verify-token')
      .set('X-Internal-Secret', internalSecret)
      .send({ token: devToken });
    expect(verify.status).toBe(201);
    expect(verify.body).toEqual({ userId: devUserId, orgId, role: 'viewer' });
  });

  it('verify-token rejects a removed member', async () => {
    const { orgId, ownerToken, devUserId, devToken } = await orgWithDeveloper('removed');
    await request(app.getHttpServer())
      .delete(`/api/v1/orgs/${orgId}/members/${devUserId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    const verify = await request(app.getHttpServer())
      .post('/internal/auth/verify-token')
      .set('X-Internal-Secret', internalSecret)
      .send({ token: devToken });
    expect(verify.status).toBe(401);
    expect(verify.body.message).toBe('No longer a member of this organization');
  });

  it('verify-api-key returns apiKeyId and effective permissions', async () => {
    const { orgId, ownerToken, devUserId, devToken } = await orgWithDeveloper('effective');
    const key = await request(app.getHttpServer())
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${devToken}`)
      .send({ name: 'Dev key', permissions: ['zone:read', 'zone:write'] });
    expect(key.status).toBe(201);
    await request(app.getHttpServer())
      .patch(`/api/v1/orgs/${orgId}/members/${devUserId}`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'viewer' });

    const verify = await request(app.getHttpServer())
      .post('/internal/auth/verify-api-key')
      .set('X-Internal-Secret', internalSecret)
      .send({ apiKey: key.body.rawKey });
    expect(verify.status).toBe(201);
    expect(verify.body).toEqual({ orgId, userId: devUserId, apiKeyId: key.body.id, permissions: ['zone:read'] });
  });

  it('api key is invalid after its creator leaves the org', async () => {
    const { orgId, ownerToken, devUserId, devToken } = await orgWithDeveloper('leaver');
    const key = await request(app.getHttpServer())
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${devToken}`)
      .send({ name: 'Leaver key', permissions: ['zone:read'] });
    expect(key.status).toBe(201);
    await request(app.getHttpServer())
      .delete(`/api/v1/orgs/${orgId}/members/${devUserId}`)
      .set('Authorization', `Bearer ${ownerToken}`);

    const verify = await request(app.getHttpServer())
      .post('/internal/auth/verify-api-key')
      .set('X-Internal-Secret', internalSecret)
      .send({ apiKey: key.body.rawKey });
    expect(verify.status).toBe(401);
  });
});
