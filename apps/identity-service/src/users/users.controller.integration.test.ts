import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { prisma } from '@rivocloud/db';
import { AppModule } from '../app.module.js';

describe('User profile endpoints', () => {
  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  beforeEach(async () => {
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();

    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'carol@example.com', password: 'hunter22222', name: 'Carol' });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'carol@example.com', password: 'hunter22222' });
    accessToken = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects requests with no bearer token', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/users/me');
    expect(response.status).toBe(401);
  });

  it('gets and updates the current user profile', async () => {
    const me = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('carol@example.com');

    const updated = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Carol Danvers' });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Carol Danvers');
  });

  it('changes the password and rejects the wrong current password', async () => {
    const wrongCurrent = await request(app.getHttpServer())
      .patch('/api/v1/users/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'not-it', newPassword: 'brand-new-pw-1' });
    expect(wrongCurrent.status).toBe(401);

    const changed = await request(app.getHttpServer())
      .patch('/api/v1/users/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'hunter22222', newPassword: 'brand-new-pw-1' });
    expect(changed.status).toBe(200);

    const loginWithNewPassword = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'carol@example.com', password: 'brand-new-pw-1' });
    expect(loginWithNewPassword.status).toBe(201);
  });

  it('soft-deletes the account and blocks future logins', async () => {
    const del = await request(app.getHttpServer())
      .delete('/api/v1/users/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(del.status).toBe(200);

    const loginAfterDelete = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'carol@example.com', password: 'hunter22222' });
    expect(loginAfterDelete.status).toBe(401);
  });
});
