import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { PrismaClient } from '@rivocloud/db';
import { isOrgRole, type OrgRole } from '@rivocloud/security';
import { PRISMA } from '../prisma/prisma.module.js';

/**
 * Reads a user's current role in an organization straight from
 * `organization_members`, so authorization never trusts a role that may be
 * stale in a JWT. Returns null when the user is not a member.
 */
@Injectable()
export class MembershipService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async currentRole(orgId: string, userId: string): Promise<OrgRole | null> {
    const membership = await this.db.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
      select: { role: true },
    });
    if (!membership || !isOrgRole(membership.role)) {
      return null;
    }
    return membership.role;
  }

  /**
   * The live role for an access token's `(org, sub)` claims. A token with no
   * org yields null without a lookup; a token naming an org the user has left
   * is rejected with 401.
   */
  async roleForTokenClaims(orgId: string | null, userId: string): Promise<OrgRole | null> {
    if (!orgId) {
      return null;
    }
    const role = await this.currentRole(orgId, userId);
    if (!role) {
      throw new UnauthorizedException('No longer a member of this organization');
    }
    return role;
  }
}
