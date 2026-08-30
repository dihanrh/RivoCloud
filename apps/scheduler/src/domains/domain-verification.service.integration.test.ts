import { describe, expect, it, beforeEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as tls from 'node:tls';
import { Redis } from 'ioredis';
import { prisma } from '@rivocloud/db';
import { DomainVerificationService } from './domain-verification.service.js';
import type { TlsCertificateResult } from './tls-check.js';

const MATCH_CERT = `-----BEGIN CERTIFICATE-----
MIIDMTCCAhmgAwIBAgIUM8SXiBgTsQZAu9YRc8AtO3o7d5wwDQYJKoZIhvcNAQEL
BQAwGjEYMBYGA1UEAwwPY2RuLmV4YW1wbGUuY29tMB4XDTI2MDgzMDA5MzA1MFoX
DTM2MDgyNzA5MzA1MFowGjEYMBYGA1UEAwwPY2RuLmV4YW1wbGUuY29tMIIBIjAN
BgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAsdAEXPR1pZ34SbRWJ0Zlh2miJB0/
pwW7ySAs7p8tPhspdfj3Ddzm1/TFspE3z8zppVOFVlNqqDdT3YQT2XHgWABhb9mW
Gr0VuVrhJ3lEeDRt8NWyn8M76I/16QtTVLa35elY8ErnHQOKGIEYJh8yrpjhXOEi
I4Jw8vQJCoCBiTNFMcJ+AUfpqG4ezqaeQs62YudxTgqw3oBQ/Stnta6vBfRD2dBc
eUjkljlpBMSJ+KnCjTwcbqns43LwyUgBQ1GKCNmw3r+5PksNmXN7GaEQEn4tZkWF
QHos+329JfO4SSSQQII+f15mbuM791kp9ASDuqCCGZwFQ608ZmhlDKy7EQIDAQAB
o28wbTAdBgNVHQ4EFgQUfU1BMPSqb1ganbxQiriKuS0+dFkwHwYDVR0jBBgwFoAU
fU1BMPSqb1ganbxQiriKuS0+dFkwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzAR
gg9jZG4uZXhhbXBsZS5jb20wDQYJKoZIhvcNAQELBQADggEBAEPBPEKmWaUiYJPI
vJw+0g4P11MlewMFR1V/fOmQB5tQOvgUlXijIme1t7FmQZsbbuQ+ZU1xuod5gDvu
VGarov0DKhItq8xX+PYa306V4ZIauPUb/f0aSgoxdCCFqdOqSXq7tUZRBRzh+r5o
O8RjmdcqHpzXqk/jEssEwYCk9NXah5WUl4+J8dKvb+MUfQgs+f2zi8X/BfB+l6Lo
oiXZAGiCdIUsE7y/bWDnDLIKCaB094XAjPU7MLicVRBrj8363zj2X3VPJiDPMeuv
2/S8YJsC1JvwAKHEFjVYvdW5wzuZx4GMIj8Db4wF8C5R/7ZPRnwuybdNIo6rh/BL
YegI07g=
-----END CERTIFICATE-----`;

const MATCH_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCx0ARc9HWlnfhJ
tFYnRmWHaaIkHT+nBbvJICzuny0+Gyl1+PcN3ObX9MWykTfPzOmlU4VWU2qoN1Pd
hBPZceBYAGFv2ZYavRW5WuEneUR4NG3w1bKfwzvoj/XpC1NUtrfl6VjwSucdA4oY
gRgmHzKumOFc4SIjgnDy9AkKgIGJM0Uxwn4BR+mobh7Opp5CzrZi53FOCrDegFD9
K2e1rq8F9EPZ0Fx5SOSWOWkExIn4qcKNPBxuqezjcvDJSAFDUYoI2bDev7k+Sw2Z
c3sZoRASfi1mRYVAeiz7fb0l87hJJJBAgj5/XmZu4zv3WSn0BIO6oIIZnAVDrTxm
aGUMrLsRAgMBAAECggEABeiZaIRYD3WRHVPghAQXFhmYwXX2WkS6wXtv+srvzC9H
YKvx+7QyOI1h72XbcqyGvA9rMBvsAKR8BTGhHjnmQE5c7oROtFtBqEvgjPj+4Tau
y5CyU5Q/fqIgBAs0DO3YbQukwLFgfiqSsW9Cv+uL+djLLlSt13u7aJta3I46H7a1
/2thRNhZr5X1yBCJuc7v+C2TmrXULbdGhxnNY5KjFf7t987sqb+mQUi9sL//C8LP
cjF0Rj0ESrr5v+fLFz+wmbJt4XiatDsO1ZpsiywWzERsm2ZaP1K/D+HuwoYGvySf
L3A3y4gUgHq6cR01TOoOFDUA7fBjG0n3X06yDmcGBQKBgQDcMSm1XHGihLwXD7gt
Pa0CIx4bBJojqZSnjkHZx24xOrrZsPbLbP/zXlBJPKoQw1MAG4HRxDX+1DQFbkRA
4QGrjeoidRF7uAkr+WZgZB6fBunfn75Dmc5wieW+/gi2FgWyfB/E067GRFkFHxtE
R0xRxAPPKAWLvdpMA6QMGjuOZQKBgQDOuozFcYpsaT1vCs2rQYjS4y3XNVEPgihv
72rN+2osqr+icHO18GrqHUGOV0KryNNPvfFea+F0t1+K42Zg5aTZDoT8XZMQqwzE
8+yGZ7uiZ6BPFtnR3gnwROykrJnlHWsPfBnq/cghpK3mkyl7gqcXkkV1f/coAj6o
LSeyAs1JPQKBgEo/nbPVJ1BI9+/C0jUXLgahdt5fb+aEoWbatmPMNuEMz8LmRGIW
MDyNWf9IIISkiJFptR3ZzudOAPiv1P4XoWuK4B+cYDfat+UHJTltqVGwkB5jDFJZ
Q9548Wq02JUl2ef0qPXC95VNqMLsWVJtxFNyCGLLOQuFCl5FgATAt8JtAoGBAKJu
hcllqyP/lNu5G1zig0VgZ1ZfeC+9T1SUQ9FRKF2sVCKoROLB4t/M2QOkoKglhZN0
ZUCRd3aj1phkkL618c7yz58TT0ibfc8K8d+xhgbXcWhzRfbWheyZ226Qh+M0ODjU
g/DWMvfsUw+GteNsBypILfdi8qonCWBPCo+eD/rpAoGBANeQrnNPUYGafxoyao65
61EpDwukiO/x/7brnI2b3lgvZKFerlGhrkwr9NnwqhyUURf2aDnNE0pc6qq06EYJ
DKeio5iLNsVoi2EgoEAKQqlLusS4OZFzWmY9qRdvnv49H8WGrSp/0asQIcMVmiIo
8/sJVeDs0E+sVz2cHH62lWsb
-----END PRIVATE KEY-----`;

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
