import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { loadApiConfig } from "@mpesa/config";
import { PrismaService } from "../prisma/prisma.service";

export interface JwtPayload {
  sub: string;
  email: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  emailVerified: boolean;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly prisma: PrismaService) {
    const config = loadApiConfig();
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.JWT_SECRET,
    });
  }

  /**
   * Re-reads the user on every request rather than trusting the JWT payload
   * alone — a deleted/deactivated account must lose access immediately, not
   * whenever its (short-lived) access token happens to expire.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException();
    }
    return { id: user.id, email: user.email, emailVerified: user.emailVerifiedAt !== null };
  }
}
