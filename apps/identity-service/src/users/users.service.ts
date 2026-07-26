import { BadRequestException, Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { PrismaClient } from '@rivocloud/db';
import { PRISMA } from '../prisma/prisma.module.js';
import { APP_ENV } from '../app-env.token.js';
import type { AppEnv } from '../env.js';
import { hashPassword, comparePassword } from '../auth/password.util.js';

@Injectable()
export class UsersService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async getMe(userId: string) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async updateMe(userId: string, data: { name?: string; avatarUrl?: string }) {
    return this.db.user.update({ where: { id: userId }, data });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) {
      throw new BadRequestException('Account has no password set');
    }
    const valid = await comparePassword(currentPassword, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const passwordHash = await hashPassword(newPassword, this.env.BCRYPT_SALT_ROUNDS);
    await this.db.user.update({ where: { id: userId }, data: { passwordHash } });
  }

  async deleteMe(userId: string) {
    await this.db.user.update({ where: { id: userId }, data: { deletedAt: new Date() } });
  }
}
