import { Body, Controller, Delete, Get, HttpCode, Patch, UseGuards } from '@nestjs/common';
import { JwtOnlyGuard } from '../auth/jwt-only.guard.js';
import { AuthCtx, type AuthContext } from '../auth/auth-context.decorator.js';
import { UsersService } from './users.service.js';
import { UpdateMeDto } from './dto/update-me.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';

@Controller('api/v1/users/me')
@UseGuards(JwtOnlyGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async getMe(@AuthCtx() auth: AuthContext) {
    const user = await this.users.getMe(auth.userId);
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      emailVerified: user.emailVerified,
    };
  }

  @Patch()
  async updateMe(@AuthCtx() auth: AuthContext, @Body() dto: UpdateMeDto) {
    const user = await this.users.updateMe(auth.userId, dto);
    return { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl };
  }

  @Patch('password')
  @HttpCode(200)
  async changePassword(@AuthCtx() auth: AuthContext, @Body() dto: ChangePasswordDto) {
    await this.users.changePassword(auth.userId, dto.currentPassword, dto.newPassword);
    return { success: true };
  }

  @Delete()
  async deleteMe(@AuthCtx() auth: AuthContext) {
    await this.users.deleteMe(auth.userId);
    return { success: true };
  }
}
