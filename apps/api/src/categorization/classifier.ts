import type { TransactionType } from "../statements/extraction/transaction-classifier";
import { normalizeMerchantName } from "./merchant-normalization";
import type { CategoryLookup } from "./taxonomy-seeder";

/**
 * Layered categorization (docs/06-statement-processing-architecture.md):
 * deterministic rule -> merchant recognition -> owner history, each layer
 * only overriding the previous when it produces a real match. Layer 4 (ML/
 * AI classification) is deliberately not implemented yet — docs/10's own
 * risk list is explicit that layers 1-3 need to be solid before layer 4 is
 * worth adding, and this project doesn't ship placeholder AI calls. Layer 5
 * (user correction) lives in transactions/transactions.service.ts, since it
 * happens outside the extraction pipeline entirely.
 *
 * Deliberately pure and synchronous — every DB read (categories, the
 * merchant table, this owner's correction history) is loaded once per job
 * by the caller (statement-processor.ts) and passed in, rather than queried
 * per row. Keeps this fully unit-testable with no database at all.
 */

export const CLASSIFICATION_VERSION = "mpesa-categorization-v1";

const FULIZA_KEYWORDS = /fuliza|overdraft|od loan/i;
const BUNDLE_KEYWORDS = /bundle/i;

export interface RuleClassification {
  categorySlug: string;
  subcategorySlug: string | null;
  confidence: number;
}

/**
 * Layer 1. Transaction-type-first, with a description-keyword override for
 * two cases the Stage 6 TransactionType taxonomy has no dedicated value
 * for: Fuliza/overdraft activity (lands in TransactionType "pay_bill" or
 * "other" depending on phrasing) and bundle purchases (land in "other") —
 * see docs/15-extraction-engine.md's "Known gaps." Categorization can
 * resolve these correctly from the description text even though extraction
 * itself genericizes them.
 */
export function classifyByRule(transactionType: TransactionType, description: string): RuleClassification {
  switch (transactionType) {
    case "fee":
      return { categorySlug: "spending", subcategorySlug: "spending.fees", confidence: 0.9 };
    case "airtime":
      return { categorySlug: "spending", subcategorySlug: "spending.airtime", confidence: 0.9 };
    case "withdraw":
      return { categorySlug: "cash", subcategorySlug: "cash.withdrawal", confidence: 0.9 };
    case "deposit":
      return { categorySlug: "cash", subcategorySlug: "cash.deposit", confidence: 0.9 };
    case "send_money":
      return { categorySlug: "transfers", subcategorySlug: "transfers.sent", confidence: 0.85 };
    case "receive_money":
      return { categorySlug: "transfers", subcategorySlug: "transfers.received", confidence: 0.85 };
    case "pay_bill":
      if (FULIZA_KEYWORDS.test(description)) {
        return { categorySlug: "loans", subcategorySlug: "loans.repayment", confidence: 0.7 };
      }
      // Merchant recognition (layer 2) usually refines this further — a
      // pay_bill is almost always real spending, just not yet specific.
      return { categorySlug: "spending", subcategorySlug: "spending.other", confidence: 0.5 };
    case "buy_goods":
      return { categorySlug: "spending", subcategorySlug: "spending.other", confidence: 0.5 };
    case "reversal":
      // Could reverse anything — genuinely ambiguous without more context.
      return { categorySlug: "uncategorized", subcategorySlug: null, confidence: 0.3 };
    case "other":
      if (FULIZA_KEYWORDS.test(description)) {
        return { categorySlug: "loans", subcategorySlug: "loans.repayment", confidence: 0.6 };
      }
      if (BUNDLE_KEYWORDS.test(description)) {
        return { categorySlug: "spending", subcategorySlug: "spending.airtime", confidence: 0.6 };
      }
      return { categorySlug: "uncategorized", subcategorySlug: null, confidence: 0.2 };
  }
}

export interface CategoryPair {
  categoryId: string | null;
  subcategoryId: string | null;
}

/** Normalizes either a top-level or child category reference into the
 * (categoryId, subcategoryId) pair Transaction actually stores — a child's
 * parentId becomes categoryId, the child itself becomes subcategoryId; a
 * top-level node has no subcategoryId. Returns null only if the referenced
 * slug/id genuinely isn't in the lookup (a taxonomy.ts/seed bug, not a
 * runtime data issue), so this is defensive, not an expected path. */
export function resolveCategoryPair(lookup: CategoryLookup, ref: { slug: string } | { id: string }): CategoryPair | null {
  const node = "slug" in ref ? lookup.bySlug.get(ref.slug) : lookup.byId.get(ref.id);
  if (!node) return null;
  return node.parentId ? { categoryId: node.parentId, subcategoryId: node.id } : { categoryId: node.id, subcategoryId: null };
}

export interface MerchantLookupEntry {
  id: string;
  normalizedName: string;
  defaultCategoryId: string | null;
}
export type MerchantLookup = MerchantLookupEntry[];

/** Longest normalizedName match wins, so a more specific seed entry beats a
 * shorter generic one when both are substrings of the real merchant name. */
function findMerchantMatch(merchants: MerchantLookup, normalizedMerchantName: string): MerchantLookupEntry | null {
  let best: MerchantLookupEntry | null = null;
  for (const merchant of merchants) {
    if (normalizedMerchantName.includes(merchant.normalizedName) && (!best || merchant.normalizedName.length > best.normalizedName.length)) {
      best = merchant;
    }
  }
  return best;
}

/** normalized(merchantName ?? description) -> the category id of this
 * owner's most recent correction for that key. Built once per job by the
 * caller from real CategoryCorrection + Transaction rows. */
export type HistoryLookup = Map<string, string>;

export function historyKeyFor(merchantName: string | null, description: string): string {
  return normalizeMerchantName(merchantName ?? description);
}

export interface ClassifyInput {
  transactionType: TransactionType;
  description: string;
  merchantName: string | null;
}

export interface ClassificationResult extends CategoryPair {
  confidence: number;
  source: "rule" | "merchant" | "history";
  /** The specific Merchant row that produced this result, when source is
   * "merchant" — null otherwise. Lets the caller set Transaction.merchantId
   * alongside the category, not just resolve a category and forget which
   * merchant record justified it. */
  merchantId: string | null;
}

export function classifyTransaction(
  categories: CategoryLookup,
  merchants: MerchantLookup,
  history: HistoryLookup,
  input: ClassifyInput,
): ClassificationResult {
  const rule = classifyByRule(input.transactionType, input.description);
  // resolveCategoryPair only returns null if taxonomy.ts and the seeded
  // `categories` table have drifted apart (a code bug, not a runtime data
  // issue) — every classifyByRule branch names a real slug from
  // CATEGORY_TAXONOMY, "uncategorized" included, so this should never
  // actually happen outside that.
  const rulePair = resolveCategoryPair(categories, { slug: rule.subcategorySlug ?? rule.categorySlug }) ?? {
    categoryId: null,
    subcategoryId: null,
  };
  let result: ClassificationResult = { ...rulePair, confidence: rule.confidence, source: "rule", merchantId: null };

  if (input.merchantName) {
    const merchantMatch = findMerchantMatch(merchants, normalizeMerchantName(input.merchantName));
    if (merchantMatch?.defaultCategoryId) {
      const pair = resolveCategoryPair(categories, { id: merchantMatch.defaultCategoryId });
      if (pair) result = { ...pair, confidence: 0.8, source: "merchant", merchantId: merchantMatch.id };
    }
  }

  const historyMatch = history.get(historyKeyFor(input.merchantName, input.description));
  if (historyMatch) {
    const pair = resolveCategoryPair(categories, { id: historyMatch });
    if (pair) result = { ...pair, confidence: 0.95, source: "history", merchantId: result.merchantId };
  }

  return result;
}
