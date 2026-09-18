/**
 * The category taxonomy, as code — the single source of truth seeded into
 * the `categories` table (taxonomy-seeder.ts) and referenced by slug from
 * the classifier (classifier.ts). Never hardcode a database id into rule
 * logic; always go through a slug.
 *
 * Matches docs/06-statement-processing-architecture.md's "Accounting
 * distinction" section: top-level groups separate real consumption
 * ("Spending") from transfers, savings/investment movement, loan activity,
 * and cash withdrawals, which are money *movements*, not proof of spending.
 * MVP scope only — no Income bucket, since a credited M-Pesa transaction
 * (salary, refund, gift, business receipt) can't be told apart from a plain
 * P2P transfer by transaction type or description alone; those all land
 * under Transfers until a real signal (merchant recognition, user
 * correction) says otherwise.
 */

export interface CategoryDefinition {
  slug: string;
  name: string;
  children?: Array<{ slug: string; name: string }>;
}

export const CATEGORY_TAXONOMY: CategoryDefinition[] = [
  {
    slug: "spending",
    name: "Spending",
    children: [
      { slug: "spending.food", name: "Food & Dining" },
      { slug: "spending.transport", name: "Transport & Fuel" },
      { slug: "spending.bills", name: "Bills & Utilities" },
      { slug: "spending.shopping", name: "Shopping" },
      { slug: "spending.health", name: "Health & Pharmacy" },
      { slug: "spending.entertainment", name: "Entertainment" },
      { slug: "spending.airtime", name: "Airtime & Data" },
      { slug: "spending.fees", name: "Fees & Charges" },
      { slug: "spending.other", name: "Other Spending" },
    ],
  },
  {
    slug: "transfers",
    name: "Transfers",
    children: [
      { slug: "transfers.sent", name: "Sent to Individual" },
      { slug: "transfers.received", name: "Received from Individual" },
    ],
  },
  {
    slug: "savings",
    name: "Savings & Investments",
    children: [
      { slug: "savings.deposit", name: "Savings Deposit" },
      { slug: "savings.investment", name: "Investment" },
    ],
  },
  {
    slug: "loans",
    name: "Loans & Credit",
    children: [
      { slug: "loans.disbursement", name: "Loan Disbursement" },
      { slug: "loans.repayment", name: "Loan Repayment" },
    ],
  },
  {
    slug: "cash",
    name: "Cash",
    children: [
      { slug: "cash.withdrawal", name: "ATM & Agent Withdrawal" },
      { slug: "cash.deposit", name: "Cash Deposit" },
    ],
  },
  // No children — both the category and the subcategory slot stay empty
  // when nothing resolved it, rather than picking a wrong specific bucket.
  { slug: "uncategorized", name: "Uncategorized" },
];

/** A small curated set of real, well-known Kenyan merchants/billers, seeded
 * as `source: global`. Matched via merchant-normalization.ts's substring
 * match, so a specific branch name ("NAIVAS SUPERMARKET - WESTGATE") still
 * resolves through its normalized root ("NAIVAS"). This list should grow as
 * real statements reveal real recurring merchants — not be padded with
 * guesses now (see docs/16-categorization-engine.md). */
export const SEED_MERCHANTS: Array<{ normalizedName: string; canonicalName: string; categorySlug: string }> = [
  { normalizedName: "NAIVAS", canonicalName: "Naivas Supermarket", categorySlug: "spending.food" },
  { normalizedName: "CARREFOUR", canonicalName: "Carrefour", categorySlug: "spending.food" },
  { normalizedName: "QUICKMART", canonicalName: "Quickmart Supermarket", categorySlug: "spending.food" },
  { normalizedName: "GOODLIFE PHARMACY", canonicalName: "Goodlife Pharmacy", categorySlug: "spending.health" },
  { normalizedName: "KPLC", canonicalName: "Kenya Power (KPLC)", categorySlug: "spending.bills" },
  { normalizedName: "NAIROBI CITY WATER", canonicalName: "Nairobi City Water and Sewerage Company", categorySlug: "spending.bills" },
  { normalizedName: "ZUKU", canonicalName: "Zuku", categorySlug: "spending.bills" },
  { normalizedName: "SAFARICOM", canonicalName: "Safaricom", categorySlug: "spending.airtime" },
  { normalizedName: "UBER", canonicalName: "Uber", categorySlug: "spending.transport" },
  { normalizedName: "BOLT", canonicalName: "Bolt", categorySlug: "spending.transport" },
  { normalizedName: "TERRAPAY", canonicalName: "TerraPay Money Transfer Services", categorySlug: "transfers.received" },
];
