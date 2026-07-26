import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { prisma } from '@rivocloud/db';
import { AppModule } from '../app.module.js';
import { EventsService } from '../events/events.service.js';

describe('Auth flows (register -> login -> refresh -> logout)', () => {
  let app: INestApplication;
  let events: EventsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    events = moduleRef.get(EventsService);
  });

  beforeEach(async () => {
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers, rejects a duplicate email, logs in, refreshes, and logs out', async () => {
    const register = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'alice@example.com', password: 'hunter22222', name: 'Alice' });
    expect(register.status).toBe(201);
    expect(register.body.email).toBe('alice@example.com');

    const duplicate = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'alice@example.com', password: 'hunter22222', name: 'Alice Two' });
    expect(duplicate.status).toBe(409);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'alice@example.com', password: 'hunter22222' });
    expect(login.status).toBe(201);
    expect(typeof login.body.accessToken).toBe('string');
    expect(typeof login.body.refreshToken).toBe('string');

    const badLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'alice@example.com', password: 'wrong-password' });
    expect(badLogin.status).toBe(401);

    const refresh = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken });
    expect(refresh.status).toBe(201);
    expect(refresh.body.refreshToken).not.toBe(login.body.refreshToken);

    const reuseOldRefresh = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken });
    expect(reuseOldRefresh.status).toBe(401);

    const logout = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .send({ refreshToken: refresh.body.refreshToken });
    expect(logout.status).toBe(201);

    const refreshAfterLogout = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: refresh.body.refreshToken });
    expect(refreshAfterLogout.status).toBe(401);
  });

  it('verifies email with the token captured at registration, then resets a forgotten password', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'bob@example.com', password: 'hunter22222', name: 'Bob' });

    const { verificationToken } = events.getLastPublished<{ verificationToken: string }>('user.registered')!;
    const verify = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: verificationToken });
    expect(verify.status).toBe(201);

    const badVerify = await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: verificationToken }); // already consumed
    expect(badVerify.status).toBe(401);

    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'bob@example.com' });

    const { resetToken } = events.getLastPublished<{ resetToken: string }>('user.password_reset_requested')!;
    const reset = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: resetToken, newPassword: 'brand-new-pw-1' });
    expect(reset.status).toBe(201);

    const loginWithNewPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'bob@example.com', password: 'brand-new-pw-1' });
    expect(loginWithNewPassword.status).toBe(201);

    const forgotUnknownEmail = await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@example.com' });
    expect(forgotUnknownEmail.status).toBe(201); // never reveals whether the email exists

    const badReset = await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token: 'not-a-real-token', newPassword: 'brand-new-pw-2' });
    expect(badReset.status).toBe(401);
  });
});
