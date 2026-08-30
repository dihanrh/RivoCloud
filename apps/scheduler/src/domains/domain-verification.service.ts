import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { PrismaClient, ZoneDomain } from '@rivocloud/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { REDIS } from '../redis/redis.module.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';
import { resolvesToEdge } from './dns-check.js';
import { checkTlsCertificate, type TlsCertificateResult } from './tls-check.js';

type ResolveDnsFn = (domain: string, edgeHostname: string) => Promise<boolean>;
type CheckTlsFn = (domain: string) => Promise<TlsCertificateResult>;

const JOB_NAME = 'domain-dns-verification';

@Injectable()
export class DomainVerificationService {
  private readonly logger = new Logger(DomainVerificationService.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_ENV) private readonly env: AppEnv,
    // Overridable for tests (a fake DNS resolver, a TLS check pointed at a
    // local test server) — production callers get the real implementations
    // via these defaults. @Optional() tells Nest's DI container not to try
    // resolving a provider for a plain function type; it simply passes
    // `undefined`, which lets the JS default parameter apply.
    @Optional() private readonly resolveDns: ResolveDnsFn = resolvesToEdge,
    @Optional() private readonly checkTls: CheckTlsFn = (domain) => checkTlsCertificate(domain),
  ) {}

  // The single per-domain state machine, used both by the 30-second cron
  // sweep (checkPending, below) and by the CDN Service's manual "Verify"
  // action (Task 9's internal endpoint) so both paths share one
  // implementation of what "verified" actually means.
  async checkOne(domain: ZoneDomain): Promise<ZoneDomain> {
    // A domain stuck in 'error' resumes from whichever phase it last
    // succeeded at: verifiedAt is only ever set once DNS resolves, so its
    // presence means the failure happened at the SSL phase, not DNS.
    const effectiveStatus = domain.sslStatus === 'error' ? (domain.verifiedAt ? 'pending_ssl' : 'pending_dns') : domain.sslStatus;

    if (effectiveStatus === 'pending_dns') {
      return this.checkDns(domain);
    }
    if (effectiveStatus === 'pending_ssl') {
      return this.checkSsl(domain);
    }
    return domain;
  }

  async checkPending(): Promise<{ checked: number; transitioned: number }> {
    const jobRun = await this.db.jobRun.create({ data: { jobName: JOB_NAME } });
    let checked = 0;
    let transitioned = 0;
    try {
      const domains = await this.db.zoneDomain.findMany({
        where: { sslStatus: { in: ['pending_dns', 'pending_ssl'] } },
      });
      for (const domain of domains) {
        checked += 1;
        try {
          const updated = await this.checkOne(domain);
          if (updated.sslStatus !== domain.sslStatus) {
            transitioned += 1;
          }
        } catch (error) {
          this.logger.error(`domain verification failed for ${domain.domain}: ${(error as Error).message}`);
        }
      }
      await this.db.jobRun.update({
        where: { id: jobRun.id },
        data: { status: 'completed', completedAt: new Date(), metadata: { checked, transitioned } },
      });
    } catch (error) {
      await this.db.jobRun.update({
        where: { id: jobRun.id },
        data: { status: 'failed', completedAt: new Date(), error: (error as Error).message },
      });
      throw error;
    }
    return { checked, transitioned };
  }

  private async checkDns(domain: ZoneDomain): Promise<ZoneDomain> {
    const resolved = await this.resolveDns(domain.domain, this.env.EDGE_HOSTNAME);
    if (resolved) {
      await this.redis.set(`zone_host:${domain.domain}`, domain.zoneId);
      return this.db.zoneDomain.update({
        where: { id: domain.id },
        data: { sslStatus: 'pending_ssl', verifiedAt: new Date(), sslError: null },
      });
    }
    if (this.isTimedOut(domain.createdAt, this.env.DOMAIN_DNS_TIMEOUT_MINUTES)) {
      return this.db.zoneDomain.update({
        where: { id: domain.id },
        data: {
          sslStatus: 'error',
          sslError: `DNS did not resolve to ${this.env.EDGE_HOSTNAME} within ${this.env.DOMAIN_DNS_TIMEOUT_MINUTES} minutes`,
        },
      });
    }
    return domain;
  }

  private async checkSsl(domain: ZoneDomain): Promise<ZoneDomain> {
    const cert = await this.checkTls(domain.domain);
    if (cert.valid) {
      return this.db.zoneDomain.update({
        where: { id: domain.id },
        data: { sslStatus: 'active', certExpiresAt: cert.validTo, sslError: null },
      });
    }
    const since = domain.verifiedAt ?? domain.createdAt;
    if (this.isTimedOut(since, this.env.DOMAIN_SSL_TIMEOUT_MINUTES)) {
      return this.db.zoneDomain.update({
        where: { id: domain.id },
        data: { sslStatus: 'error', sslError: 'Certificate was not issued within the expected window' },
      });
    }
    return domain;
  }

  private isTimedOut(since: Date, minutes: number): boolean {
    return Date.now() - since.getTime() > minutes * 60 * 1000;
  }
}
