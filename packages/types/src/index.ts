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

export type TransactionDirection = "credit" | "debit";

export interface TransactionDTO {
  id: string;
  statementId: string;
  transactionDate: string; // ISO 8601
  transactionType: TransactionType;
  direction: TransactionDirection;
  amount: Money;
  fee: Money;
  balanceAfter: Money | null;
  description: string;
  merchantName: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  classificationConfidence: number | null;
  classificationSource: ClassificationSource | null;
  referenceNumber: string;
  isDuplicate: boolean;
}

export interface StatementDTO {
  id: string;
  ownerType: OwnerType;
  status: StatementStatus;
  originalFilename: string;
  pageCount: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  transactionCount: number;
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
  periodStart: string; // YYYY-MM-DD, always the first day of a calendar month
  periodEnd: string; // YYYY-MM-DD, always the last day of that same month
  totalReceived: Money;
  /** Real consumption only — the "Spending" top-level category's subcategories
   * (Food & Dining, Transport, Bills, ...). Excludes transfers, cash
   * withdrawals, savings, and loan activity — see docs/06's accounting
   * distinction and docs/17-analytics-engine.md. */
  totalSpent: Money;
  /** Sum of transactionType "fee" rows — M-Pesa's own charges appear as
   * their own transaction rows, not a sub-field on the transaction they're
   * attached to (docs/17). */
  totalFees: Money;
  /** totalReceived minus every debit in the period, regardless of category
   * — the actual balance movement, not a category-filtered figure. */
  netMovement: Money;
  /** One entry per Spending subcategory with any activity this period,
   * sorted by total descending ("biggest categories"). `categoryId` here is
   * the specific subcategory's id. */
  byCategory: Array<{ categoryId: string; categoryName: string; total: Money }>;
  /** Top real merchants by spend this period (Transfers/Cash/etc. excluded
   * — a P2P transfer's counterparty isn't a "merchant"). */
  topMerchants: Array<{ merchantName: string; total: Money; transactionCount: number }>;
}
