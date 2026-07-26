import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { PrismaClient } from '@rivocloud/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';
import { TokenService } from './token.service.js';
import { hashPassword, comparePassword } from './password.util.js';
import { EventsService } from '../events/events.service.js';
import { generateRawToken, hashToken } from './token-hash.util.js';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
    private readonly tokens: TokenService,
    private readonly events: EventsService,
  ) {}

  async register(email: string, password: string, name: string) {
    const existing = await this.db.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }
    const passwordHash = await hashPassword(password, this.env.BCRYPT_SALT_ROUNDS);
    const user = await this.db.user.create({ data: { email, passwordHash, name } });

    const { raw, hash } = generateRawToken();
    await this.db.emailVerificationToken.create({
      data: { userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS) },
    });
    await this.events.publish('user.registered', { userId: user.id, email: user.email, verificationToken: raw });

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
    if (!user || !user.passwordHash || user.deletedAt) {
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
    if (!user || user.deletedAt) {
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

  async verifyEmail(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const record = await this.db.emailVerificationToken.findUnique({ where: { tokenHash } });
    if (!record || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired verification token');
    }
    await this.db.user.update({ where: { id: record.userId }, data: { emailVerified: true } });
    await this.db.emailVerificationToken.delete({ where: { id: record.id } });
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.db.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) {
      return; // Do not reveal whether the email exists.
    }
    const { raw, hash } = generateRawToken();
    await this.db.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS) },
    });
    await this.events.publish('user.password_reset_requested', { userId: user.id, email: user.email, resetToken: raw });
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    const record = await this.db.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }
    const passwordHash = await hashPassword(newPassword, this.env.BCRYPT_SALT_ROUNDS);
    await this.db.user.update({ where: { id: record.userId }, data: { passwordHash } });
    await this.db.passwordResetToken.delete({ where: { id: record.id } });
  }

  async selectOrg(userId: string, orgId: string): Promise<AuthTokens> {
    const membership = await this.db.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
    });
    if (!membership) {
      throw new UnauthorizedException('Not a member of this organization');
    }
    const accessToken = await this.tokens.mintAccessToken({ sub: userId, org: orgId, role: membership.role });
    const refreshToken = await this.tokens.mintRefreshToken(userId);
    return { accessToken, refreshToken };
  }
}
