import type { Direction } from "./reconciliation";

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

/**
 * Deterministic, keyword-based transaction *type* — part of normalization
 * (docs/06), not Stage 7's category taxonomy (Food, Transport, etc.). This
 * only answers "what kind of M-Pesa operation was this," which the
 * statement's own description text names fairly literally.
 */
export function classifyTransactionType(description: string, direction: Direction): TransactionType {
  const text = description.toLowerCase();

  if (/charge$|transaction cost/.test(text)) return "fee";
  if (/reversal/.test(text)) return "reversal";
  if (/airtime/.test(text)) return "airtime";
  if (/pay bill/.test(text)) return "pay_bill";
  if (/merchant payment|buy goods/.test(text)) return "buy_goods";
  if (/customer transfer|sent to|transfer to/.test(text)) return "send_money";
  if (/funds received|received from/.test(text)) return "receive_money";
  if (/withdrawal|agent/.test(text)) return "withdraw";
  if (/deposit/.test(text)) return "deposit";

  // Fall back to direction alone when the description doesn't name the
  // operation clearly — still better than a bare "other" for a credit/debit
  // we can at least place directionally.
  return direction === "credit" ? "receive_money" : "other";
}

/**
 * Best-effort counterparty/merchant name from the description — "to NAME"
 * or "from NAME" up to the next digit run (M-Pesa descriptions typically
 * follow the counterparty name with an account/phone number) or end of
 * string. Returns null rather than guessing wrong when the pattern doesn't
 * match cleanly.
 */
export function extractMerchantName(description: string): string | null {
  const match = /\b(?:to|from)\s+([A-Za-z][A-Za-z .'&-]*?)(?=\s+\d|\s*$)/i.exec(description);
  const name = match?.[1]?.trim();
  return name && name.length > 0 ? name : null;
}
