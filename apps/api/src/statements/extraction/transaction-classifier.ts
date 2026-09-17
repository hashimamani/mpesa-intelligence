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

// Real descriptions put a numeric identifier (a till/paybill number, or a
// masked phone number like "2547******338") between "to"/"from" and the
// actual counterparty name — e.g. "to 522533 - Lipa na KCB", "to
// -2547******338 GRACE OTIENO", "from 573388 - TERRAPAY MONEY TRANSFER
// SERVICES (KENYA) LIMITED." Captures the name after that identifier (and
// an optional " - " separator), stopping at " Acc." (an account-number
// suffix), a sentence-ending ". ", or end of string. Calibrated against a
// real statement, not assumed from the format's public documentation alone.
const MERCHANT_PATTERN = /\b(?:to|from)\s+-?\d[\d*]*\s*-?\s*([A-Za-z][A-Za-z .,'&()-]*?)(?:\s+Acc\.|\.\s|\s*$)/i;

/**
 * Best-effort counterparty/merchant name from the description. Returns null
 * rather than guessing wrong when the pattern doesn't match cleanly.
 */
export function extractMerchantName(description: string): string | null {
  const match = MERCHANT_PATTERN.exec(description);
  const name = match?.[1]?.trim().replace(/[-\s]+$/, "");
  return name && name.length > 0 ? name : null;
}
