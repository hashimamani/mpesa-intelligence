import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";

/**
 * Argon2id (argon2's default) is OWASP's current first recommendation for
 * password hashing — deliberately slow/memory-hard, unlike the fast hashing
 * used for refresh tokens (see token.service.ts, which hashes for fast
 * lookup, not to resist brute force of a secret a user chose).
 */
@Injectable()
export class PasswordService {
  async hash(plainPassword: string): Promise<string> {
    return argon2.hash(plainPassword);
  }

  async verify(passwordHash: string, plainPassword: string): Promise<boolean> {
    return argon2.verify(passwordHash, plainPassword);
  }
}
