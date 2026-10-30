/**
 * Shared integration-test fixtures for organization membership flows
 * (register -> login -> create org -> invite -> log in -> select org).
 * Test-only: imported by `*.integration.test.ts` files, never by app code.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

export const TEST_PASSWORD = 'hunter22222';

export type InvitableRole = 'admin' | 'developer' | 'viewer';

/** Registers a user and logs in; returns an org-less access token. */
export async function registerAndLogin(app: INestApplication, email: string, name: string): Promise<string> {
  await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email, password: TEST_PASSWORD, name });
  const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });
  return login.body.accessToken as string;
}

/** Registers an owner and creates an org; returns the org id and the owner's org-scoped token. */
export async function createOrg(app: INestApplication, email: string, name: string, orgName: string) {
  const token = await registerAndLogin(app, email, name);
  const create = await request(app.getHttpServer())
    .post('/api/v1/orgs')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: orgName });
  if (create.status !== 201) {
    throw new Error(`createOrg(${orgName}) failed: ${create.status} ${JSON.stringify(create.body)}`);
  }
  return { orgId: create.body.organization.id as string, ownerToken: create.body.accessToken as string };
}

/**
 * Registers a user, invites them into `orgId` with `role` (using `inviterToken`),
 * then logs them in and selects the org. Returns their user id and org-scoped token.
 */
export async function joinOrg(
  app: INestApplication,
  orgId: string,
  inviterToken: string,
  email: string,
  role: InvitableRole,
) {
  await registerAndLogin(app, email, email.split('@')[0] ?? email);
  const invite = await request(app.getHttpServer())
    .post(`/api/v1/orgs/${orgId}/members`)
    .set('Authorization', `Bearer ${inviterToken}`)
    .send({ email, role });
  if (invite.status !== 201) {
    throw new Error(`joinOrg(${email} as ${role}) failed: ${invite.status} ${JSON.stringify(invite.body)}`);
  }
  const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: TEST_PASSWORD });
  const selected = await request(app.getHttpServer())
    .post('/api/v1/auth/select-org')
    .set('Authorization', `Bearer ${login.body.accessToken}`)
    .send({ orgId });
  return { userId: invite.body.userId as string, token: selected.body.accessToken as string };
}

/** An org with an owner and one developer, using `prefix` to keep emails and names unique. */
export async function orgWithDeveloper(app: INestApplication, prefix: string) {
  const { orgId, ownerToken } = await createOrg(app, `${prefix}owner@example.com`, 'Owner', `${prefix} Org`);
  const dev = await joinOrg(app, orgId, ownerToken, `${prefix}dev@example.com`, 'developer');
  return { orgId, ownerToken, devUserId: dev.userId, devToken: dev.token };
}
