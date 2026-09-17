import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
  UsePipes,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import {
  forgotPasswordSchema,
  loginSchema,
  refreshTokenSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  type ForgotPasswordInput,
  type LoginInput,
  type RefreshTokenInput,
  type RegisterInput,
  type ResetPasswordInput,
  type VerifyEmailInput,
} from "@mpesa/validation";
import type { AuthUserDTO } from "@mpesa/types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { CurrentUser } from "./current-user.decorator";
import type { AuthenticatedUser } from "./jwt.strategy";
import type { IssuedRefreshToken } from "./token.service";

const REFRESH_TOKEN_COOKIE = "refresh_token";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private setRefreshTokenCookie(res: Response, refreshToken: IssuedRefreshToken): void {
    res.cookie(REFRESH_TOKEN_COOKIE, refreshToken.rawToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/auth",
      expires: refreshToken.expiresAt,
    });
  }

  // Registration/login are rate-limited more tightly than the app default
  // (see ThrottlerModule in app.module.ts) — brute-force/credential-stuffing
  // protection per docs/05-security-threat-model.md.
  @Post("register")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(registerSchema))
  async register(@Body() body: RegisterInput): Promise<{ user: AuthUserDTO }> {
    return this.auth.register(body.email, body.password);
  }

  @Post("verify-email")
  @UsePipes(new ZodValidationPipe(verifyEmailSchema))
  @HttpCode(200)
  async verifyEmail(@Body() body: VerifyEmailInput): Promise<{ verified: true }> {
    await this.auth.verifyEmail(body.token);
    return { verified: true };
  }

  @Post("login")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(loginSchema))
  @HttpCode(200)
  async login(
    @Body() body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string; user: AuthUserDTO }> {
    const { accessToken, user, refreshToken } = await this.auth.login(
      body.email,
      body.password,
      req.headers["user-agent"],
    );
    this.setRefreshTokenCookie(res, refreshToken);
    return { accessToken, user };
  }

  @Post("refresh")
  @UsePipes(new ZodValidationPipe(refreshTokenSchema))
  @HttpCode(200)
  async refresh(
    @Body() body: RefreshTokenInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ accessToken: string }> {
    const rawRefreshToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_TOKEN_COOKIE] ?? body.refreshToken;
    if (!rawRefreshToken) {
      res.status(401);
      return { accessToken: "" };
    }
    const { accessToken, refreshToken } = await this.auth.refresh(rawRefreshToken, req.headers["user-agent"]);
    this.setRefreshTokenCookie(res, refreshToken);
    return { accessToken };
  }

  @Post("logout")
  @HttpCode(204)
  async logout(
    @Body() body: { refreshToken?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const rawRefreshToken = (req.cookies as Record<string, string> | undefined)?.[REFRESH_TOKEN_COOKIE] ?? body?.refreshToken;
    if (rawRefreshToken) {
      await this.auth.logout(rawRefreshToken);
    }
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: "/auth" });
  }

  @Post("forgot-password")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UsePipes(new ZodValidationPipe(forgotPasswordSchema))
  @HttpCode(200)
  async forgotPassword(@Body() body: ForgotPasswordInput): Promise<{ ok: true }> {
    await this.auth.forgotPassword(body.email);
    return { ok: true };
  }

  @Post("reset-password")
  @UsePipes(new ZodValidationPipe(resetPasswordSchema))
  @HttpCode(200)
  async resetPassword(@Body() body: ResetPasswordInput): Promise<{ ok: true }> {
    await this.auth.resetPassword(body.token, body.newPassword);
    return { ok: true };
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}
