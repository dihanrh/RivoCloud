import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipService } from './membership.service.js';

/**
 * Loads the caller's live membership in the organization named by `:orgId`
 * and stores it as `request.orgRole`. A non-member gets 404, so the guard
 * does not reveal whether the organization exists. Routes without `:orgId`
 * pass through untouched. Must run after JwtOnlyGuard.
 */
@Injectable()
export class OrgMemberGuard implements CanActivate {
  constructor(private readonly membership: MembershipService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const orgId: string | undefined = request.params?.orgId;
    if (!orgId) {
      return true;
    }
    const userId: string | undefined = request.auth?.userId;
    const role = userId ? await this.membership.currentRole(orgId, userId) : null;
    if (!role) {
      throw new NotFoundException('Organization not found');
    }
    request.orgRole = role;
    return true;
  }
}
