import { randomBytes, createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { loadApiConfig } from "@mpesa/config";
import { PrismaService } from "../prisma/prisma.service";

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1h

/** Parses simple durations like "15m", "30d", "1h" — the only formats used
 * by JWT_ACCESS_TOKEN_TTL/JWT_REFRESH_TOKEN_TTL in practice. Not a general
 * parser; intentionally narrow. */
function parseDurationMs(duration: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(duration.trim());
  if (!match) {
    throw new Error(`Unsupported duration format: "${duration}" (expected e.g. "15m", "30d")`);
  }
  const value = Number(match[1]);
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as "s" | "m" | "h" | "d"];
  return value * unitMs;
}

function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function generateRawToken(): string {
  return randomBytes(32).toString("hex");
}

export interface IssuedRefreshToken {
  rawToken: string;
  expiresAt: Date;
}

/**
 * Refresh tokens and single-use tokens (email verification, password reset)
 * are opaque random strings, stored only as a sha256 hash — never the raw
 * value — same principle as password hashing, but fast-hashed since these
 * are high-entropy random tokens, not user-chosen secrets (no brute-force
 * resistance needed, just "don't store the bearer secret in plaintext").
 */
@Injectable()
export class TokenService {
  constructor(private readonly prisma: PrismaService) {}

  async issueRefreshToken(userId: string, userAgent: string | undefined): Promise<IssuedRefreshToken> {
    const config = loadApiConfig();
    const rawToken = generateRawToken();
    const expiresAt = new Date(Date.now() + parseDurationMs(config.JWT_REFRESH_TOKEN_TTL));

    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: hashToken(rawToken), userAgent, expiresAt },
    });

    return { rawToken, expiresAt };
  }

  /**
   * Validates and rotates a refresh token: the presented token is revoked and
   * a new one issued in its place. If the presented token was *already*
   * revoked, that's a reuse signal (the token was stolen and used after the
   * legitimate client already rotated past it) — every active session for
   * the user is revoked defensively rather than trusting this request.
   */
  async rotateRefreshToken(
    rawToken: string,
    userAgent: string | undefined,
  ): Promise<{ userId: string; issued: IssuedRefreshToken } | { reuseDetected: true } | null> {
    const tokenHash = hashToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (!existing) return null;

    if (existing.revokedAt) {
      await this.revokeAllRefreshTokensForUser(existing.userId);
      return { reuseDetected: true };
    }
    if (existing.expiresAt < new Date()) return null;

    const issued = await this.issueRefreshToken(existing.userId, userAgent);
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedByTokenHash: hashToken(issued.rawToken) },
    });

    return { userId: existing.userId, issued };
  }

  async revokeRefreshToken(rawToken: string): Promise<void> {
    const tokenHash = hashToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllRefreshTokensForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async issueEmailVerificationToken(userId: string): Promise<string> {
    const rawToken = generateRawToken();
    await this.prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
      },
    });
    return rawToken;
  }

  /** Returns the userId and marks the token used, or null if invalid/expired/already used. */
  async consumeEmailVerificationToken(rawToken: string): Promise<string | null> {
    const tokenHash = hashToken(rawToken);
    const record = await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt < new Date()) return null;

    await this.prisma.emailVerificationToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    return record.userId;
  }

  async issuePasswordResetToken(userId: string): Promise<string> {
    const rawToken = generateRawToken();
    await this.prisma.passwordResetToken.create({
      data: {
        userId,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
      },
    });
    return rawToken;
  }

  async consumePasswordResetToken(rawToken: string): Promise<string | null> {
    const tokenHash = hashToken(rawToken);
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt < new Date()) return null;

    await this.prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    return record.userId;
  }
}
