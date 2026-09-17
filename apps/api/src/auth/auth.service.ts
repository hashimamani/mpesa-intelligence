import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { loadApiConfig } from "@mpesa/config";
import type { AuthLoginResponseDTO, AuthUserDTO } from "@mpesa/types";
import { PrismaService } from "../prisma/prisma.service";
import { EmailService } from "../email/email.service";
import { PasswordService } from "./password.service";
import { TokenService, type IssuedRefreshToken } from "./token.service";

function toAuthUserDTO(user: { id: string; email: string; emailVerifiedAt: Date | null; createdAt: Date }): AuthUserDTO {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly password: PasswordService,
    private readonly tokens: TokenService,
    private readonly email: EmailService,
  ) {}

  private signAccessToken(userId: string, email: string): string {
    const config = loadApiConfig();
    return this.jwt.sign({ sub: userId, email }, { expiresIn: config.JWT_ACCESS_TOKEN_TTL });
  }

  async register(email: string, plainPassword: string): Promise<{ user: AuthUserDTO }> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Same response shape either way at the controller level in a future
      // pass would avoid account enumeration; flagged as a hardening item
      // rather than blocking Stage 4 on it (docs/10-risks-and-decisions.md).
      throw new ConflictException("An account with this email already exists");
    }

    const passwordHash = await this.password.hash(plainPassword);
    const user = await this.prisma.user.create({ data: { email, passwordHash } });

    const verificationToken = await this.tokens.issueEmailVerificationToken(user.id);
    const config = loadApiConfig();
    const verifyUrl = `${config.WEB_APP_URL}/verify-email?token=${verificationToken}`;
    await this.email.send({
      to: user.email,
      subject: "Verify your email",
      body: `Welcome to M-Pesa Financial Intelligence. Verify your email: ${verifyUrl}`,
    });

    return { user: toAuthUserDTO(user) };
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const userId = await this.tokens.consumeEmailVerificationToken(rawToken);
    if (!userId) {
      throw new UnauthorizedException("This verification link is invalid or has expired");
    }
    await this.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  }

  async login(
    email: string,
    plainPassword: string,
    userAgent: string | undefined,
  ): Promise<AuthLoginResponseDTO & { refreshToken: IssuedRefreshToken }> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Deliberately identical error for "no such user" and "wrong password" —
    // distinguishing them lets an attacker enumerate registered emails.
    if (!user || user.deletedAt) {
      throw new UnauthorizedException("Invalid email or password");
    }
    const valid = await this.password.verify(user.passwordHash, plainPassword);
    if (!valid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    const accessToken = this.signAccessToken(user.id, user.email);
    const refreshToken = await this.tokens.issueRefreshToken(user.id, userAgent);

    return { accessToken, user: toAuthUserDTO(user), refreshToken };
  }

  async refresh(
    rawRefreshToken: string,
    userAgent: string | undefined,
  ): Promise<{ accessToken: string; refreshToken: IssuedRefreshToken }> {
    const result = await this.tokens.rotateRefreshToken(rawRefreshToken, userAgent);
    if (!result || "reuseDetected" in result) {
      throw new UnauthorizedException("Session expired — please log in again");
    }

    const user = await this.prisma.user.findUnique({ where: { id: result.userId } });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException("Session expired — please log in again");
    }

    return { accessToken: this.signAccessToken(user.id, user.email), refreshToken: result.issued };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await this.tokens.revokeRefreshToken(rawRefreshToken);
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Always behave the same way whether or not the account exists — the
    // response must not reveal which emails are registered.
    if (!user || user.deletedAt) return;

    const resetToken = await this.tokens.issuePasswordResetToken(user.id);
    const config = loadApiConfig();
    const resetUrl = `${config.WEB_APP_URL}/reset-password?token=${resetToken}`;
    await this.email.send({
      to: user.email,
      subject: "Reset your password",
      body: `Reset your password: ${resetUrl}\nIf you didn't request this, you can ignore this email.`,
    });
  }

  async resetPassword(rawToken: string, newPlainPassword: string): Promise<void> {
    const userId = await this.tokens.consumePasswordResetToken(rawToken);
    if (!userId) {
      throw new UnauthorizedException("This reset link is invalid or has expired");
    }
    const passwordHash = await this.password.hash(newPlainPassword);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
    // A password reset is a strong signal to kill every existing session —
    // if the reset was triggered by an attacker who no longer has the new
    // password, this locks them out too; if it was the real user, their
    // other sessions were likely already compromised (why they reset it).
    await this.tokens.revokeAllRefreshTokensForUser(userId);
  }
}
