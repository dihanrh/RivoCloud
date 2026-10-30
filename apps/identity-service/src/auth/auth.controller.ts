import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { NoAudit, RATE_LIMITS, RateLimit } from '@rivocloud/security';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { LogoutDto } from './dto/logout.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { SelectOrgDto } from './dto/select-org.dto.js';
import { JwtOnlyGuard } from './jwt-only.guard.js';
import { AuthCtx, type AuthContext } from './auth-context.decorator.js';

// Auth flows are not audited (no actor yet, and bodies carry credentials).
@NoAudit()
@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @RateLimit(RATE_LIMITS.auth)
  async register(@Body() dto: RegisterDto) {
    const user = await this.auth.register(dto.email, dto.password, dto.name);
    return { id: user.id, email: user.email, name: user.name };
  }

  @Post('login')
  @RateLimit(RATE_LIMITS.auth)
  async login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('refresh')
  async refreshToken(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  async logout(@Body() dto: LogoutDto, @Headers('authorization') authorization?: string) {
    const accessToken = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined;
    await this.auth.logout(dto.refreshToken, accessToken);
    return { success: true };
  }

  @Post('verify-email')
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    await this.auth.verifyEmail(dto.token);
    return { success: true };
  }

  @Post('forgot-password')
  @RateLimit(RATE_LIMITS.forgotPassword)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.requestPasswordReset(dto.email);
    return { success: true };
  }

  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.newPassword);
    return { success: true };
  }

  @Post('select-org')
  @UseGuards(JwtOnlyGuard)
  async selectOrg(@AuthCtx() authCtx: AuthContext, @Body() dto: SelectOrgDto) {
    return this.auth.selectOrg(authCtx.userId, dto.orgId);
  }
}
