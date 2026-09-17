// Shared domain types, mirroring docs/04-database-erd.md.
// This is the single source of truth for shapes crossing the api/web/mobile boundary.

export type OwnerType = "user" | "organization";

export type OrganizationRole = "owner" | "admin" | "analyst" | "viewer";

export type SubscriptionTier = "free" | "premium" | "business";

export type SubscriptionStatus =
  | "active"
  | "payment_failed"
  | "grace_period"
  | "canceled"
  | "expired";

export type StatementStatus =
  | "pending_upload"
  | "uploaded"
  | "processing"
  | "processed"
  | "failed"
  | "needs_review";

export type ProcessingStage =
  | "uploaded"
  | "reading_transactions"
  | "categorizing"
  | "calculating_analytics"
  | "generating_insights"
  | "complete";

export type TransactionType =
  | "send_money"
  | "receive_money"
  | "pay_bill"
  | "buy_goods"
  | "withdraw"
  | "deposit"
  | "airtime"
  | "reversal"
  | "fee"
  | "other";

export type ClassificationSource =
  | "rule"
  | "merchant"
  | "history"
  | "ai"
  | "user_correction";

export type InsightType =
  | "trend"
  | "opportunity"
  | "anomaly"
  | "recurring"
  | "positive"
  | "warning"
  | "pattern";

export type InsightSeverity = "low" | "medium" | "high";

/** Money is always an exact decimal string over the wire — never a float. See docs/03-architecture.md. */
export interface Money {
  amount: string;
  currency: "KES";
}

export interface CategoryDTO {
  id: string;
  parentId: string | null;
  name: string;
  isActive: boolean;
}

export interface TransactionDTO {
  id: string;
  statementId: string;
  transactionDate: string; // ISO 8601
  transactionType: TransactionType;
  amount: Money;
  fee: Money;
  balanceAfter: Money | null;
  description: string;
  merchantName: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  classificationConfidence: number | null;
  classificationSource: ClassificationSource | null;
  referenceNumber: string | null;
}

export interface StatementDTO {
  id: string;
  ownerType: OwnerType;
  status: StatementStatus;
  originalFilename: string;
  pageCount: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
}

export interface StatementProcessingJobDTO {
  id: string;
  statementId: string;
  stage: ProcessingStage;
  errorCode: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface StatementWithJobDTO {
  statement: StatementDTO;
  job: StatementProcessingJobDTO | null;
}

export interface UploadUrlResponseDTO {
  statementId: string;
  uploadUrl: string;
  expiresAt: string;
}

export interface InsightDTO {
  id: string;
  type: InsightType;
  severity: InsightSeverity;
  claim: string;
  supportingMetrics: Record<string, unknown>;
  confidence: number;
}

export interface AuthUserDTO {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
}

export interface AuthLoginResponseDTO {
  accessToken: string;
  user: AuthUserDTO;
}

export interface SpendingSummaryDTO {
  periodStart: string;
  periodEnd: string;
  totalReceived: Money;
  totalSpent: Money;
  totalFees: Money;
  netMovement: Money;
  byCategory: Array<{ categoryId: string; total: Money }>;
}
