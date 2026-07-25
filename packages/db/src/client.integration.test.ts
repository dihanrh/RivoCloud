import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from './index.js';

describe('prisma client against a real Postgres instance', () => {
  beforeEach(async () => {
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a user and reads it back', async () => {
    const user = await prisma.user.create({
      data: { email: 'founder@rivocloud.dev', name: 'Founder' },
    });

    const found = await prisma.user.findUnique({ where: { id: user.id } });

    expect(found?.email).toBe('founder@rivocloud.dev');
    expect(found?.emailVerified).toBe(false);
  });

  it('creates an organization owned by a user and lists its members', async () => {
    const owner = await prisma.user.create({
      data: { email: 'owner@rivocloud.dev', name: 'Owner' },
    });

    const org = await prisma.organization.create({
      data: { name: 'Acme Inc', slug: 'acme-inc', ownerId: owner.id },
    });

    await prisma.organizationMember.create({
      data: { orgId: org.id, userId: owner.id, role: 'owner' },
    });

    const members = await prisma.organizationMember.findMany({ where: { orgId: org.id } });

    expect(members).toHaveLength(1);
    expect(members[0].role).toBe('owner');
  });

  it('enforces the unique (orgId, slug) constraint on pull zones', async () => {
    const owner = await prisma.user.create({
      data: { email: 'zones@rivocloud.dev', name: 'Zone Owner' },
    });
    const org = await prisma.organization.create({
      data: { name: 'Zone Org', slug: 'zone-org', ownerId: owner.id },
    });

    await prisma.pullZone.create({
      data: { orgId: org.id, name: 'assets', slug: 'assets', originUrl: 'https://origin.example.com' },
    });

    await expect(
      prisma.pullZone.create({
        data: { orgId: org.id, name: 'assets-2', slug: 'assets', originUrl: 'https://origin2.example.com' },
      }),
    ).rejects.toThrow();

    await prisma.pullZone.deleteMany({ where: { orgId: org.id } });
  });
});
