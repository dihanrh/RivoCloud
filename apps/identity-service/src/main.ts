import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { configureTrustProxy } from '@rivocloud/security';
import { AppModule } from './app.module.js';
import { loadEnv } from './env.js';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);
  configureTrustProxy(app, env.TRUST_PROXY);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(env.PORT);
  console.log(`identity-service listening on :${env.PORT}`);
}

bootstrap();
