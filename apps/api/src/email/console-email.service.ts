import { Injectable, Logger } from "@nestjs/common";
import { EmailService, type SendEmailInput } from "./email.service";

/**
 * Development/test-only stand-in: logs the email instead of sending it. This
 * is deliberately never selected in production — see EmailModule, which
 * refuses to start with NODE_ENV=production unless a real EMAIL_PROVIDER is
 * configured, rather than silently letting real users' verification emails
 * disappear into a log line.
 */
@Injectable()
export class ConsoleEmailService extends EmailService {
  private readonly logger = new Logger("Email (dev/console)");

  async send(input: SendEmailInput): Promise<void> {
    this.logger.log(
      `[DEV EMAIL — not actually sent] To: ${input.to} | Subject: ${input.subject}\n${input.body}`,
    );
  }
}
