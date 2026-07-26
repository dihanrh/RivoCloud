import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@rivocloud/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';
import { hashPassword, comparePassword } from '../auth/password.util.js';
import { generateApiKey } from './api-key.util.js';
import { scopesAllowedForRole, isOrgRole, type ApiKeyScope } from '../organizations/roles.js';

@Injectable()
export class ApiKeysService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  private async assertScopesAllowedForCaller(orgId: string, userId: string, requested: ApiKeyScope[]) {
    const membership = await this.db.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (!membership || !isOrgRole(membership.role)) {
      throw new ForbiddenException('Not a member of this organization');
    }
    const allowed = new Set(scopesAllowedForRole(membership.role));
    const disallowed = requested.filter((scope) => !allowed.has(scope));
    if (disallowed.length > 0) {
      throw new ForbiddenException(
        `Your role (${membership.role}) cannot grant scopes: ${disallowed.join(', ')}`,
      );
    }
  }

  async create(orgId: string, userId: string, name: string, permissions: ApiKeyScope[], testMode: boolean) {
    if (permissions.length === 0) {
      throw new BadRequestException('At least one permission scope is required');
    }
    await this.assertScopesAllowedForCaller(orgId, userId, permissions);

    const { raw, prefix } = generateApiKey(testMode);
    const keyHash = await hashPassword(raw, this.env.BCRYPT_SALT_ROUNDS);
    const apiKey = await this.db.apiKey.create({
      data: { orgId, userId, name, keyHash, keyPrefix: prefix, permissions },
    });
    return { id: apiKey.id, name: apiKey.name, keyPrefix: apiKey.keyPrefix, permissions, rawKey: raw };
  }

  async list(orgId: string) {
    const keys = await this.db.apiKey.findMany({ where: { orgId, revokedAt: null } });
    return keys.map((key) => ({
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      permissions: key.permissions,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
    }));
  }

  async update(orgId: string, userId: string, keyId: string, data: { name?: string; permissions?: ApiKeyScope[] }) {
    const key = await this.db.apiKey.findUnique({ where: { id: keyId } });
    if (!key || key.orgId !== orgId || key.revokedAt) {
      throw new NotFoundException('API key not found');
    }
    if (data.permissions) {
      await this.assertScopesAllowedForCaller(orgId, userId, data.permissions);
    }
    return this.db.apiKey.update({ where: { id: keyId }, data });
  }

  async revoke(orgId: string, keyId: string) {
    const key = await this.db.apiKey.findUnique({ where: { id: keyId } });
    if (!key || key.orgId !== orgId || key.revokedAt) {
      throw new NotFoundException('API key not found');
    }
    await this.db.apiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
  }

  async verifyRawKey(raw: string) {
    const prefix = raw.slice(0, 12);
    const candidates = await this.db.apiKey.findMany({ where: { keyPrefix: prefix, revokedAt: null } });
    for (const candidate of candidates) {
      if (candidate.expiresAt && candidate.expiresAt < new Date()) {
        continue;
      }
      if (await comparePassword(raw, candidate.keyHash)) {
        await this.db.apiKey.update({ where: { id: candidate.id }, data: { lastUsedAt: new Date() } });
        return candidate;
      }
    }
    return null;
  }
}
