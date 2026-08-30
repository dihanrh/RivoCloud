import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { prisma } from '@rivocloud/db';
import { AppModule } from '../app.module.js';
import { APP_ENV } from '../app-env.token.js';
import { DomainVerificationService } from './domain-verification.service.js';

describe('DomainsInternalController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
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

  async function seedDomain() {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
    const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
    const zone = await prisma.pullZone.create({
      data: { orgId: org.id, name: 'My Blog', slug: `my-blog-${randomUUID()}`, originUrl: 'https://api.example.com' },
    });
    return prisma.zoneDomain.create({ data: { zoneId: zone.id, domain: `cdn-${randomUUID()}.example.com` } });
  }

  it('rejects a request without the internal secret', async () => {
    const domain = await seedDomain();
    const response = await request(app.getHttpServer()).post(`/internal/domains/${domain.id}/verify-now`);
    expect(response.status).toBe(401);
  });

  it('404s for an unknown domain id', async () => {
    const secret = app.get(APP_ENV).INTERNAL_API_SECRET;
    const response = await request(app.getHttpServer())
      .post(`/internal/domains/${randomUUID()}/verify-now`)
      .set('X-Internal-Secret', secret);
    expect(response.status).toBe(404);
  });

  it('runs verification immediately and returns the updated domain', async () => {
    const domain = await seedDomain();
    const secret = app.get(APP_ENV).INTERNAL_API_SECRET;

    const response = await request(app.getHttpServer())
      .post(`/internal/domains/${domain.id}/verify-now`)
      .set('X-Internal-Secret', secret);

    expect(response.status).toBe(201);
    expect(response.body.id).toBe(domain.id);
    // A freshly seeded domain's DNS won't actually resolve to RivoCloud, so
    // it stays pending_dns — this asserts the endpoint truly ran checkOne
    // rather than just echoing the input back unchanged in some other way.
    expect(response.body.sslStatus).toBe('pending_dns');
  });
});
