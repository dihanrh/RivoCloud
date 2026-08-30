import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { prisma } from '@rivocloud/db';
import { AppModule } from '../app.module.js';
import { IdentityClient } from '../auth/identity-client.js';
import type { CombinedAuthContext } from '../auth/auth-context.decorator.js';
import { SchedulerClient, type VerifyDomainResult } from './scheduler-client.js';

class FakeIdentityClient {
  nextAuth: CombinedAuthContext | null = null;
  async verifyToken(): Promise<CombinedAuthContext> {
    if (!this.nextAuth) throw new Error('FakeIdentityClient.nextAuth not set');
    return this.nextAuth;
  }
  async verifyApiKey(): Promise<CombinedAuthContext> {
    if (!this.nextAuth) throw new Error('FakeIdentityClient.nextAuth not set');
    return this.nextAuth;
  }
}

class FakeSchedulerClient {
  nextResult: VerifyDomainResult = { id: 'unused', sslStatus: 'pending_ssl', sslError: null };
  lastDomainId: string | null = null;
  async verifyDomainNow(domainId: string): Promise<VerifyDomainResult> {
    this.lastDomainId = domainId;
    return this.nextResult;
  }
}

describe('DomainsController', () => {
  let app: INestApplication;
  let fakeIdentity: FakeIdentityClient;
  let fakeScheduler: FakeSchedulerClient;

  beforeAll(async () => {
    fakeIdentity = new FakeIdentityClient();
    fakeScheduler = new FakeSchedulerClient();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IdentityClient)
      .useValue(fakeIdentity)
      .overrideProvider(SchedulerClient)
      .useValue(fakeScheduler)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.zoneDomain.deleteMany();
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  async function seedZoneAndAuth(role: string) {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
    const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
    fakeIdentity.nextAuth = { type: 'jwt', userId: user.id, orgId: org.id, role };
    const zone = await prisma.pullZone.create({
      data: { orgId: org.id, name: 'My Blog', slug: `my-blog-${randomUUID()}`, originUrl: 'https://api.example.com' },
    });
    return zone;
  }

  it('creates and lists a domain', async () => {
    const zone = await seedZoneAndAuth('owner');
    const created = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/domains`)
      .set('Authorization', 'Bearer whatever')
      .send({ domain: `cdn-${randomUUID()}.example.com` });
    expect(created.status).toBe(201);
    expect(created.body.sslStatus).toBe('pending_dns');
    expect(created.body.cnameTarget).toBeTruthy();

    const list = await request(app.getHttpServer())
      .get(`/api/v1/zones/${zone.id}/domains`)
      .set('Authorization', 'Bearer whatever');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
  });

  it('rejects an invalid hostname', async () => {
    const zone = await seedZoneAndAuth('owner');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/domains`)
      .set('Authorization', 'Bearer whatever')
      .send({ domain: 'not a hostname!' });
    expect(response.status).toBe(400);
  });

  it('rejects a viewer trying to add a domain', async () => {
    const zone = await seedZoneAndAuth('viewer');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/domains`)
      .set('Authorization', 'Bearer whatever')
      .send({ domain: `cdn-${randomUUID()}.example.com` });
    expect(response.status).toBe(403);
  });

  it('deletes a domain', async () => {
    const zone = await seedZoneAndAuth('admin');
    const created = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/domains`)
      .set('Authorization', 'Bearer whatever')
      .send({ domain: `cdn-${randomUUID()}.example.com` });

    const deleted = await request(app.getHttpServer())
      .delete(`/api/v1/zones/${zone.id}/domains/${created.body.id}`)
      .set('Authorization', 'Bearer whatever');
    expect(deleted.status).toBe(200);
  });

  it('verify calls the Scheduler and returns its result', async () => {
    const zone = await seedZoneAndAuth('owner');
    const created = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/domains`)
      .set('Authorization', 'Bearer whatever')
      .send({ domain: `cdn-${randomUUID()}.example.com` });

    fakeScheduler.nextResult = { id: created.body.id, sslStatus: 'active', sslError: null };
    const verified = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/domains/${created.body.id}/verify`)
      .set('Authorization', 'Bearer whatever');
    expect(verified.status).toBe(201);
    expect(verified.body).toEqual({ id: created.body.id, sslStatus: 'active', sslError: null });
    expect(fakeScheduler.lastDomainId).toBe(created.body.id);
  });

  it('verify 404s for a domain that does not belong to the zone', async () => {
    const zone = await seedZoneAndAuth('owner');
    const response = await request(app.getHttpServer())
      .post(`/api/v1/zones/${zone.id}/domains/${randomUUID()}/verify`)
      .set('Authorization', 'Bearer whatever');
    expect(response.status).toBe(404);
  });
});
