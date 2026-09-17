export interface SendEmailInput {
  to: string;
  subject: string;
  body: string;
}

/**
 * Every real send goes through this interface — see docs/07-ai-architecture.md's
 * provider-abstraction pattern, applied here to email. No call site talks to a
 * vendor SDK directly, so plugging in a real provider (Stage 15) touches one
 * file, not every place that sends an email.
 */
export abstract class EmailService {
  abstract send(input: SendEmailInput): Promise<void>;
}
