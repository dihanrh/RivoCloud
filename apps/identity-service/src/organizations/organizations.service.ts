import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@rivocloud/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { EventsService } from '../events/events.service.js';
import { slugify } from './slug.util.js';
import type { OrgRole } from './roles.js';

@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly events: EventsService,
  ) {}

  async create(ownerId: string, name: string) {
    const baseSlug = slugify(name) || 'org';
    let slug = baseSlug;
    let attempt = 0;
    while (await this.db.organization.findUnique({ where: { slug } })) {
      attempt += 1;
      slug = `${baseSlug}-${attempt}`;
    }

    const org = await this.db.organization.create({
      data: {
        name,
        slug,
        ownerId,
        members: { create: { userId: ownerId, role: 'owner', joinedAt: new Date() } },
      },
    });
    await this.events.publish('org.created', { orgId: org.id, ownerId, slug: org.slug });
    return org;
  }

  async listForUser(userId: string) {
    return this.db.organization.findMany({ where: { members: { some: { userId } } } });
  }

  async getForMember(orgId: string, userId: string) {
    const membership = await this.db.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (!membership) {
      throw new NotFoundException('Organization not found');
    }
    return this.db.organization.findUniqueOrThrow({ where: { id: orgId } });
  }

  async update(orgId: string, data: { name?: string }) {
    return this.db.organization.update({ where: { id: orgId }, data });
  }

  async delete(orgId: string) {
    await this.db.organization.delete({ where: { id: orgId } });
  }

  async listMembers(orgId: string) {
    return this.db.organizationMember.findMany({ where: { orgId }, include: { user: true } });
  }

  async addMember(orgId: string, invitedBy: string, email: string, role: OrgRole) {
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user) {
      throw new NotFoundException('No registered user with that email — they must sign up first');
    }
    const existing = await this.db.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId: user.id } },
    });
    if (existing) {
      throw new ConflictException('User is already a member of this organization');
    }
    return this.db.organizationMember.create({
      data: { orgId, userId: user.id, role, invitedBy, joinedAt: new Date() },
    });
  }

  async updateMemberRole(orgId: string, targetUserId: string, role: OrgRole) {
    const membership = await this.db.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    if (!membership) {
      throw new NotFoundException('Member not found');
    }
    if (membership.role === 'owner') {
      throw new ForbiddenException("The organization's owner role cannot be changed here");
    }
    return this.db.organizationMember.update({
      where: { orgId_userId: { orgId, userId: targetUserId } },
      data: { role },
    });
  }

  async removeMember(orgId: string, targetUserId: string) {
    const membership = await this.db.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    if (!membership) {
      throw new NotFoundException('Member not found');
    }
    if (membership.role === 'owner') {
      throw new ForbiddenException('Cannot remove the organization owner');
    }
    await this.db.organizationMember.delete({ where: { orgId_userId: { orgId, userId: targetUserId } } });
  }
}
