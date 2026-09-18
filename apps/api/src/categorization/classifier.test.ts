import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyByRule, classifyTransaction, resolveCategoryPair, type MerchantLookup } from "./classifier";
import type { CategoryLookup } from "./taxonomy-seeder";
import { CATEGORY_TAXONOMY } from "./taxonomy";

/** Builds a CategoryLookup identical in shape to what taxonomy-seeder.ts's
 * loadCategoryLookup would return, but from the taxonomy definition
 * directly — no database needed for these tests. */
function buildTestCategoryLookup(): CategoryLookup {
  const bySlug = new Map<string, { id: string; parentId: string | null }>();
  const byId = new Map<string, { id: string; parentId: string | null }>();

  for (const top of CATEGORY_TAXONOMY) {
    const node = { id: top.slug, parentId: null };
    bySlug.set(top.slug, node);
    byId.set(top.slug, node);
    for (const child of top.children ?? []) {
      const childNode = { id: child.slug, parentId: top.slug };
      bySlug.set(child.slug, childNode);
      byId.set(child.slug, childNode);
    }
  }
  return { bySlug, byId };
}

const categories = buildTestCategoryLookup();

test("rule layer: fee/airtime/withdraw/deposit/send_money/receive_money map to their obvious category", () => {
  assert.deepEqual(classifyByRule("fee", "Pay Bill Online Charge"), {
    categorySlug: "spending",
    subcategorySlug: "spending.fees",
    confidence: 0.9,
  });
  assert.equal(classifyByRule("airtime", "Airtime Purchase").subcategorySlug, "spending.airtime");
  assert.equal(classifyByRule("withdraw", "Customer Withdrawal at Agent").subcategorySlug, "cash.withdrawal");
  assert.equal(classifyByRule("deposit", "Cash Deposit").subcategorySlug, "cash.deposit");
  assert.equal(classifyByRule("send_money", "Customer Transfer to JOHN").subcategorySlug, "transfers.sent");
  assert.equal(classifyByRule("receive_money", "Funds received from JANE").subcategorySlug, "transfers.received");
});

test("rule layer: pay_bill/buy_goods default to Spending > Other, refined later by merchant recognition", () => {
  assert.equal(classifyByRule("pay_bill", "Pay Bill Online to KPLC").subcategorySlug, "spending.other");
  assert.equal(classifyByRule("buy_goods", "Merchant Payment to NAIVAS").subcategorySlug, "spending.other");
});

test("rule layer: reversal and unrecognized 'other' land in Uncategorized, not a guess", () => {
  const reversal = classifyByRule("reversal", "Reversal of Pay Bill transaction");
  assert.equal(reversal.categorySlug, "uncategorized");
  assert.equal(reversal.subcategorySlug, null);

  const other = classifyByRule("other", "Some unrecognized future M-Pesa product");
  assert.equal(other.categorySlug, "uncategorized");
});

test("rule layer: Fuliza/overdraft description keywords resolve to Loans even though TransactionType doesn't distinguish them (docs/15's known gap)", () => {
  assert.equal(classifyByRule("pay_bill", "OverDraft of Credit Party").subcategorySlug, "loans.repayment");
  assert.equal(classifyByRule("other", "OD Loan Repayment").subcategorySlug, "loans.repayment");
  assert.equal(classifyByRule("other", "Fuliza M-Pesa").subcategorySlug, "loans.repayment");
});

test("rule layer: bundle purchases (TransactionType 'other') resolve to Airtime & Data", () => {
  assert.equal(classifyByRule("other", "Data Bundle Purchase").subcategorySlug, "spending.airtime");
});

test("resolveCategoryPair: a top-level slug has no subcategoryId; a child's parent becomes categoryId", () => {
  assert.deepEqual(resolveCategoryPair(categories, { slug: "spending" }), { categoryId: "spending", subcategoryId: null });
  assert.deepEqual(resolveCategoryPair(categories, { slug: "spending.food" }), { categoryId: "spending", subcategoryId: "spending.food" });
});

test("resolveCategoryPair returns null for an unknown slug/id rather than guessing", () => {
  assert.equal(resolveCategoryPair(categories, { slug: "not-a-real-category" }), null);
});

test("classifyTransaction: rule layer alone when no merchant/history match", () => {
  const result = classifyTransaction(categories, [], new Map(), {
    transactionType: "airtime",
    description: "Airtime Purchase",
    merchantName: null,
  });
  assert.equal(result.categoryId, "spending");
  assert.equal(result.subcategoryId, "spending.airtime");
  assert.equal(result.source, "rule");
  assert.equal(result.merchantId, null);
});

test("classifyTransaction: merchant recognition overrides the rule layer's low-confidence default", () => {
  const merchants: MerchantLookup = [{ id: "merchant-1", normalizedName: "NAIVAS", defaultCategoryId: "spending.food" }];
  const result = classifyTransaction(categories, merchants, new Map(), {
    transactionType: "buy_goods",
    description: "Merchant Payment Online to 5509416 - NAIVAS SUPERMARKET",
    merchantName: "NAIVAS SUPERMARKET",
  });
  assert.equal(result.categoryId, "spending");
  assert.equal(result.subcategoryId, "spending.food");
  assert.equal(result.source, "merchant");
  assert.equal(result.merchantId, "merchant-1");
});

test("classifyTransaction: a branch/location suffix on the real merchant name still matches a shorter seed", () => {
  const merchants: MerchantLookup = [{ id: "merchant-1", normalizedName: "GOODLIFE PHARMACY", defaultCategoryId: "spending.health" }];
  const result = classifyTransaction(categories, merchants, new Map(), {
    transactionType: "buy_goods",
    description: "Merchant Payment Online to 7062028 - GOODLIFE PHARMACY - DIANI CENTRE POINT",
    merchantName: "GOODLIFE PHARMACY - DIANI CENTRE POINT",
  });
  assert.equal(result.subcategoryId, "spending.health");
  assert.equal(result.source, "merchant");
});

test("classifyTransaction: owner history (layer 3) outranks both the rule and merchant layers", () => {
  const merchants: MerchantLookup = [{ id: "merchant-1", normalizedName: "NAIVAS", defaultCategoryId: "spending.food" }];
  const history = new Map([["NAIVAS SUPERMARKET", "spending.shopping"]]);
  const result = classifyTransaction(categories, merchants, history, {
    transactionType: "buy_goods",
    description: "Merchant Payment Online to 5509416 - NAIVAS SUPERMARKET",
    merchantName: "NAIVAS SUPERMARKET",
  });
  assert.equal(result.subcategoryId, "spending.shopping"); // the owner's own correction, not the global merchant default
  assert.equal(result.source, "history");
  // Still remembers which merchant record matched, even though history won.
  assert.equal(result.merchantId, "merchant-1");
});

test("classifyTransaction: history keyed by description when there's no merchant name at all", () => {
  const history = new Map([["PAY BILL ONLINE CHARGE", "spending.fees"]]);
  const result = classifyTransaction(categories, [], history, {
    transactionType: "fee",
    description: "Pay Bill Online Charge",
    merchantName: null,
  });
  assert.equal(result.source, "history");
});
