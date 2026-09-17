import { z } from "zod";

// Shared request-validation schemas, used identically by the API (as the authoritative
// boundary check) and by web/mobile clients (for inline form feedback). The API's
// server-side validation is what actually matters — client-side use is UX only.

export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .regex(/[A-Z]/, "Password must include an uppercase letter")
  .regex(/[0-9]/, "Password must include a number");

export const registerSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(1),
});
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const refreshTokenSchema = z.object({
  // Optional because the primary path is an httpOnly cookie (see
  // apps/api/src/auth) — this body field is a fallback for non-browser
  // clients that can't rely on a cookie jar (e.g. a future mobile app).
  refreshToken: z.string().min(1).optional(),
});
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;

export const statementUploadSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.literal("application/pdf"),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(25 * 1024 * 1024, "Statement must be 25MB or smaller"),
});
export type StatementUploadInput = z.infer<typeof statementUploadSchema>;

export const categoryCorrectionSchema = z.object({
  transactionId: z.string().uuid(),
  categoryId: z.string().uuid(),
});
export type CategoryCorrectionInput = z.infer<typeof categoryCorrectionSchema>;

export const savingsGoalSchema = z.object({
  name: z.string().min(1).max(120),
  targetAmount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Must be a valid decimal amount"),
  targetDate: z.string().date(),
});
export type SavingsGoalInput = z.infer<typeof savingsGoalSchema>;
