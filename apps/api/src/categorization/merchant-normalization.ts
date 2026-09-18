/**
 * Normalizes a merchant/description string for matching against the
 * `merchants` table: uppercased, punctuation stripped, whitespace collapsed.
 * A real extracted merchant name commonly carries a branch/location suffix
 * ("NAIVAS SUPERMARKET - WESTGATE") or an account number tail, so matching
 * is substring-based (normalizeMerchantName(name).includes(seed.normalizedName))
 * rather than exact equality — see taxonomy.ts's SEED_MERCHANTS comment.
 */
export function normalizeMerchantName(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[.,'()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
