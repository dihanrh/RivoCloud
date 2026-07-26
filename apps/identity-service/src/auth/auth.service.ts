import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { PrismaClient } from '@rivocloud/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';
import { TokenService } from './token.service.js';
import { hashPassword, comparePassword } from './password.util.js';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly tokens: TokenService,
  ) {}

  async register(email: string, password: string, name: string) {
    const existing = await this.db.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }
    const passwordHash = await hashPassword(password, this.env.BCRYPT_SALT_ROUNDS);
    const user = await this.db.user.create({ data: { email, passwordHash, name } });
    return user;
  }

  private async mintTokensForUser(userId: string): Promise<AuthTokens> {
    const memberships = await this.db.organizationMember.findMany({ where: { userId } });
    const soleMembership = memberships.length === 1 ? memberships[0] : null;

    const accessToken = await this.tokens.mintAccessToken({
      sub: userId,
      org: soleMembership?.orgId ?? null,
      role: soleMembership?.role ?? null,
    });
    const refreshToken = await this.tokens.mintRefreshToken(userId);
    return { accessToken, refreshToken };
  }

  async login(email: string, password: string): Promise<AuthTokens> {
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.mintTokensForUser(user.id);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let rotated: { userId: string; newRefreshToken: string };
    try {
      rotated = await this.tokens.verifyAndRotateRefreshToken(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const user = await this.db.user.findUnique({ where: { id: rotated.userId } });
    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    const memberships = await this.db.organizationMember.findMany({ where: { userId: user.id } });
    const soleMembership = memberships.length === 1 ? memberships[0] : null;
    const accessToken = await this.tokens.mintAccessToken({
      sub: user.id,
      org: soleMembership?.orgId ?? null,
      role: soleMembership?.role ?? null,
    });
    return { accessToken, refreshToken: rotated.newRefreshToken };
  }

  async logout(refreshToken: string, accessToken?: string): Promise<void> {
    await this.tokens.revokeRefreshToken(refreshToken);
    if (!accessToken) {
      return;
    }
    try {
      const claims = await this.tokens.verifyAccessToken(accessToken);
      const remaining = claims.exp - Math.floor(Date.now() / 1000);
      await this.tokens.blacklistAccessToken(claims.jti, remaining);
    } catch {
      // Access token already invalid/expired/absent — nothing to blacklist.
    }
  }
}
