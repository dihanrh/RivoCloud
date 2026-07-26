import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import { Controller, Get, INestApplication, UseGuards, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { prisma } from '@rivocloud/db';
import { AppModule } from '../app.module.js';
import { AuthGuard } from './auth-guard.js';
import { AuthModule } from './auth.module.js';
import { ApiKeysModule } from '../api-keys/api-keys.module.js';

@Controller('test/whoami')
@UseGuards(AuthGuard)
class WhoAmIController {
  @Get()
  whoAmI() {
    return { ok: true };
  }
}

describe('AuthGuard: accepts both a JWT bearer token and an X-API-Key header', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, AuthModule, ApiKeysModule],
      controllers: [WhoAmIController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  beforeEach(async () => {
    await prisma.apiKey.deleteMany();
    await prisma.organizationMember.deleteMany();
    await prisma.organization.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a request with neither credential', async () => {
    const response = await request(app.getHttpServer()).get('/test/whoami');
    expect(response.status).toBe(401);
  });

  it('accepts a valid JWT bearer token', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'guardjwt@example.com', password: 'hunter22222', name: 'Guard Jwt' });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'guardjwt@example.com', password: 'hunter22222' });

    const response = await request(app.getHttpServer())
      .get('/test/whoami')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(response.status).toBe(200);
  });

  it('accepts a valid API key via X-API-Key and rejects it once revoked', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'guardkey@example.com', password: 'hunter22222', name: 'Guard Key' });
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'guardkey@example.com', password: 'hunter22222' });
    const org = await request(app.getHttpServer())
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ name: 'Guard Key Org' });
    const key = await request(app.getHttpServer())
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${org.body.accessToken}`)
      .send({ name: 'Guard test key', permissions: ['zone:read'] });

    const withKey = await request(app.getHttpServer()).get('/test/whoami').set('X-API-Key', key.body.rawKey);
    expect(withKey.status).toBe(200);

    await request(app.getHttpServer())
      .delete(`/api/v1/api-keys/${key.body.id}`)
      .set('Authorization', `Bearer ${org.body.accessToken}`);

    const withRevokedKey = await request(app.getHttpServer()).get('/test/whoami').set('X-API-Key', key.body.rawKey);
    expect(withRevokedKey.status).toBe(401);
  });
});
