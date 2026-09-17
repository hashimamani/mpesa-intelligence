import { Module } from "@nestjs/common";
import { loadApiConfig } from "@mpesa/config";
import { EmailService } from "./email.service";
import { ConsoleEmailService } from "./console-email.service";

@Module({
  providers: [
    {
      provide: EmailService,
      useFactory: (): EmailService => {
        const config = loadApiConfig();
        if (config.EMAIL_PROVIDER) {
          // No real provider is wired up yet (see docs/10-risks-and-decisions.md,
          // item D-5 territory for email specifically) — this branch exists so
          // that setting EMAIL_PROVIDER is a deliberate signal to implement one,
          // not a silent no-op.
          throw new Error(
            `EMAIL_PROVIDER=${config.EMAIL_PROVIDER} is set, but no EmailService implementation exists for it yet. Implement one in apps/api/src/email before configuring this.`,
          );
        }
        if (config.NODE_ENV === "production") {
          throw new Error(
            "No email provider is configured (EMAIL_PROVIDER is unset) and NODE_ENV=production. " +
              "Refusing to start: falling back to logging verification/reset emails to the " +
              "console would mean real users never receive them.",
          );
        }
        return new ConsoleEmailService();
      },
    },
  ],
  exports: [EmailService],
})
export class EmailModule {}
