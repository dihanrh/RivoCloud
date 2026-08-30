import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { prisma } from '@rivocloud/db';
import { DomainVerificationService } from './domain-verification.service.js';
import type { TlsCertificateResult } from './tls-check.js';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
const env = { EDGE_HOSTNAME: 'edge.rivocloud.dev', DOMAIN_DNS_TIMEOUT_MINUTES: 30, DOMAIN_SSL_TIMEOUT_MINUTES: 15 };

async function seedZoneAndDomain(overrides: Partial<{ sslStatus: string; createdAt: Date; verifiedAt: Date | null }> = {}) {
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com`, name: 'Owner' } });
  const org = await prisma.organization.create({ data: { name: 'Org', slug: `org-${randomUUID()}`, ownerId: user.id } });
  const zone = await prisma.pullZone.create({
    data: { orgId: org.id, name: 'My Blog', slug: `my-blog-${randomUUID()}`, originUrl: 'https://api.example.com' },
  });
  const domain = await prisma.zoneDomain.create({
    data: {
      zoneId: zone.id,
      domain: `cdn-${randomUUID()}.example.com`,
      sslStatus: overrides.sslStatus ?? 'pending_dns',
      createdAt: overrides.createdAt,
      verifiedAt: overrides.verifiedAt,
    },
  });
  return { zone, domain };
}

describe('DomainVerificationService', () => {
  beforeEach(async () => {
    await prisma.zoneDomain.deleteMany();
    await prisma.pullZone.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
    await prisma.jobRun.deleteMany();
  });

  afterAll(() => {
    redis.disconnect();
  });

  it('transitions pending_dns to pending_ssl and writes zone_host when DNS resolves', async () => {
    const { zone, domain } = await seedZoneAndDomain();
    const resolveDns = async () => true;
    const checkTls = async (): Promise<TlsCertificateResult> => ({ valid: false });
    const service = new DomainVerificationService(prisma, redis, env as never, resolveDns, checkTls);

    const updated = await service.checkOne(domain);

    expect(updated.sslStatus).toBe('pending_ssl');
    expect(updated.verifiedAt).not.toBeNull();
    expect(await redis.get(`zone_host:${domain.domain}`)).toBe(zone.id);
  });

  it('leaves pending_dns unchanged when DNS has not resolved yet and the timeout has not elapsed', async () => {
    const { domain } = await seedZoneAndDomain();
    const resolveDns = async () => false;
    const checkTls = async (): Promise<TlsCertificateResult> => ({ valid: false });
    const service = new DomainVerificationService(prisma, redis, env as never, resolveDns, checkTls);

    const updated = await service.checkOne(domain);
    expect(updated.sslStatus).toBe('pending_dns');
  });

  it('flips pending_dns to error once the DNS timeout has elapsed', async () => {
    const timedOutEnv = { ...env, DOMAIN_DNS_TIMEOUT_MINUTES: 30 };
    const { domain } = await seedZoneAndDomain({ createdAt: new Date(Date.now() - 31 * 60 * 1000) });
    const resolveDns = async () => false;
    const checkTls = async (): Promise<TlsCertificateResult> => ({ valid: false });
    const service = new DomainVerificationService(prisma, redis, timedOutEnv as never, resolveDns, checkTls);

    const updated = await service.checkOne(domain);
    expect(updated.sslStatus).toBe('error');
    expect(updated.sslError).toContain('DNS');
  });

  it('transitions pending_ssl to active with the certificate expiry when the TLS handshake matches', async () => {
    const { domain } = await seedZoneAndDomain({ sslStatus: 'pending_ssl', verifiedAt: new Date() });
    const resolveDns = async () => true;
    const validTo = new Date('2036-08-27T00:00:00Z');
    const checkTls = async (): Promise<TlsCertificateResult> => ({ valid: true, validTo });
    const service = new DomainVerificationService(prisma, redis, env as never, resolveDns, checkTls);

    const updated = await service.checkOne(domain);
    expect(updated.sslStatus).toBe('active');
    expect(updated.certExpiresAt?.toISOString()).toBe(validTo.toISOString());
  });

  it('flips pending_ssl to error once the SSL timeout has elapsed', async () => {
    const { domain } = await seedZoneAndDomain({
      sslStatus: 'pending_ssl',
      verifiedAt: new Date(Date.now() - 16 * 60 * 1000),
    });
    const resolveDns = async () => true;
    const checkTls = async (): Promise<TlsCertificateResult> => ({ valid: false });
    const service = new DomainVerificationService(prisma, redis, env as never, resolveDns, checkTls);

    const updated = await service.checkOne(domain);
    expect(updated.sslStatus).toBe('error');
    expect(updated.sslError).toContain('Certificate');
  });

  it('an error domain that already resolved DNS retries at the SSL phase, not from scratch', async () => {
    const { domain } = await seedZoneAndDomain({ sslStatus: 'error', verifiedAt: new Date() });
    let dnsCalled = false;
    const resolveDns = async () => {
      dnsCalled = true;
      return true;
    };
    const checkTls = async (): Promise<TlsCertificateResult> => ({ valid: true, validTo: new Date('2036-01-01') });
    const service = new DomainVerificationService(prisma, redis, env as never, resolveDns, checkTls);

    const updated = await service.checkOne(domain);
    expect(dnsCalled).toBe(false);
    expect(updated.sslStatus).toBe('active');
  });

  it('an active domain is left unchanged', async () => {
    const { domain } = await seedZoneAndDomain({ sslStatus: 'active', verifiedAt: new Date() });
    const resolveDns = async () => true;
    const checkTls = async (): Promise<TlsCertificateResult> => ({ valid: true, validTo: new Date() });
    const service = new DomainVerificationService(prisma, redis, env as never, resolveDns, checkTls);

    const updated = await service.checkOne(domain);
    expect(updated.sslStatus).toBe('active');
  });

  it('checkPending records a JobRun and reports how many domains transitioned', async () => {
    await seedZoneAndDomain();
    await seedZoneAndDomain({ sslStatus: 'active' });
    const resolveDns = async () => true;
    const checkTls = async (): Promise<TlsCertificateResult> => ({ valid: false });
    const service = new DomainVerificationService(prisma, redis, env as never, resolveDns, checkTls);

    const result = await service.checkPending();
    expect(result.checked).toBe(1);
    expect(result.transitioned).toBe(1);

    const jobRuns = await prisma.jobRun.findMany({ where: { jobName: 'domain-dns-verification' } });
    expect(jobRuns).toHaveLength(1);
    expect(jobRuns[0].status).toBe('completed');
  });
});
