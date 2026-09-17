import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

/**
 * Validates a request body against a schema from @mpesa/validation — the same
 * schema the web/mobile clients use for inline form feedback. This is the
 * boundary that actually matters (see packages/validation/src/index.ts):
 * client-side validation is UX only, this is what's authoritative.
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const issues = result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));
      throw new BadRequestException({ message: "Validation failed", issues });
    }
    return result.data;
  }
}
