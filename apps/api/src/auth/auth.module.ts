import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { loadApiConfig } from "@mpesa/config";
import { EmailModule } from "../email/email.module";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";
import { JwtStrategy } from "./jwt.strategy";

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      useFactory: () => {
        const config = loadApiConfig();
        return { secret: config.JWT_SECRET, signOptions: { expiresIn: config.JWT_ACCESS_TOKEN_TTL } };
      },
    }),
    EmailModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, JwtStrategy],
  exports: [JwtStrategy, PassportModule],
})
export class AuthModule {}
