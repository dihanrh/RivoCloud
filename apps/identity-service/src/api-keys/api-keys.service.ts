import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { ApiKey, PrismaClient } from '@rivocloud/db';
import { scopesAllowedForRole, type ApiKeyScope, type OrgRole } from '@rivocloud/security';
import { PRISMA } from '../prisma/prisma.module.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';
import { hashPassword, comparePassword } from '../auth/password.util.js';
import { MembershipService } from '../organizations/membership.service.js';
import { generateApiKey } from './api-key.util.js';

/** A verified API key, with permissions already capped at its creator's current role. */
export interface VerifiedApiKey {
  id: string;
  orgId: string;
  userId: string;
  permissions: ApiKeyScope[];
}

/** The caller managing keys: their user id and live role in the key's org. */
export interface ApiKeyCaller {
  userId: string;
  role: OrgRole | null;
}

const KEY_MANAGER_ROLES: readonly OrgRole[] = ['owner', 'admin'];

/** The public view of a key. Never includes `keyHash`, the verifier for the secret. */
function toApiKeyView(key: ApiKey) {
  return {
    id: key.id,
    name: key.name,
    keyPrefix: key.keyPrefix,
    permissions: key.permissions,
    userId: key.userId,
    lastUsedAt: key.lastUsedAt,
    expiresAt: key.expiresAt,
  };
}

@Injectable()
export class ApiKeysService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly membership: MembershipService,
  ) {}

  private async assertScopesAllowedForCaller(orgId: string, userId: string, requested: ApiKeyScope[]) {
    const role = await this.membership.currentRole(orgId, userId);
    if (!role) {
      throw new ForbiddenException('Not a member of this organization');
    }
    this.assertScopesAllowedForRole(role, requested, `Your role (${role})`);
  }

  /**
   * A key's scopes are always capped at its creator's current role, whoever
   * edits it: an owner/admin cannot widen a developer's key past developer scopes.
   */
  private async assertScopesAllowedForKeyCreator(
    orgId: string,
    creatorId: string | null,
    requested: ApiKeyScope[],
  ) {
    const role = creatorId ? await this.membership.currentRole(orgId, creatorId) : null;
    if (!role) {
      throw new ForbiddenException("The key's creator is no longer a member of this organization");
    }
    this.assertScopesAllowedForRole(role, requested, `The key creator's role (${role})`);
  }

  private assertScopesAllowedForRole(role: OrgRole, requested: ApiKeyScope[], subject: string) {
    const allowed = new Set(scopesAllowedForRole(role));
    const disallowed = requested.filter((scope) => !allowed.has(scope));
    if (disallowed.length > 0) {
      throw new ForbiddenException(`${subject} cannot grant scopes: ${disallowed.join(', ')}`);
    }
  }

  /** Owner/Admin may manage any key in the org; everyone else only keys they created. */
  private async findManageableKey(orgId: string, caller: ApiKeyCaller, keyId: string) {
    const key = await this.db.apiKey.findUnique({ where: { id: keyId } });
    if (!key || key.orgId !== orgId || key.revokedAt) {
      throw new NotFoundException('API key not found');
    }
    const isManager = caller.role !== null && KEY_MANAGER_ROLES.includes(caller.role);
    if (!isManager && key.userId !== caller.userId) {
      throw new ForbiddenException('You can only manage API keys you created');
    }
    return key;
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
    return keys.map(toApiKeyView);
  }

  async update(
    orgId: string,
    caller: ApiKeyCaller,
    keyId: string,
    data: { name?: string; permissions?: ApiKeyScope[] },
  ) {
    const key = await this.findManageableKey(orgId, caller, keyId);
    if (data.permissions) {
      await this.assertScopesAllowedForKeyCreator(orgId, key.userId, data.permissions);
    }
    return toApiKeyView(await this.db.apiKey.update({ where: { id: keyId }, data }));
  }

  async revoke(orgId: string, caller: ApiKeyCaller, keyId: string) {
    await this.findManageableKey(orgId, caller, keyId);
    await this.db.apiKey.update({ where: { id: keyId }, data: { revokedAt: new Date() } });
  }

  /**
   * Verifies a raw key. Returns null when it is unknown, revoked, expired, or
   * its creator is no longer a member of the key's org (or the key has no
   * creator). Permissions are the stored ones intersected with the scopes the
   * creator's current role allows.
   */
  async verifyRawKey(raw: string): Promise<VerifiedApiKey | null> {
    const prefix = raw.slice(0, 12);
    const candidates = await this.db.apiKey.findMany({ where: { keyPrefix: prefix, revokedAt: null } });
    for (const candidate of candidates) {
      if (candidate.expiresAt && candidate.expiresAt < new Date()) {
        continue;
      }
      if (!(await comparePassword(raw, candidate.keyHash))) {
        continue;
      }
      if (!candidate.userId) {
        return null;
      }
      const creatorRole = await this.membership.currentRole(candidate.orgId, candidate.userId);
      if (!creatorRole) {
        return null;
      }
      await this.db.apiKey.update({ where: { id: candidate.id }, data: { lastUsedAt: new Date() } });
      const allowed = new Set<string>(scopesAllowedForRole(creatorRole));
      const stored = Array.isArray(candidate.permissions) ? candidate.permissions : [];
      const permissions = stored.filter(
        (scope): scope is ApiKeyScope => typeof scope === 'string' && allowed.has(scope),
      );
      return { id: candidate.id, orgId: candidate.orgId, userId: candidate.userId, permissions };
    }
    return null;
  }
}
