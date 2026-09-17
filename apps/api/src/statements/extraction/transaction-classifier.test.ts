import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyTransactionType, extractMerchantName } from "./transaction-classifier";

test("classifies transaction types from realistic M-Pesa description text", () => {
  assert.equal(classifyTransactionType("Pay Bill Online to KPLC PREPAID Acc. 987654321", "debit"), "pay_bill");
  assert.equal(classifyTransactionType("Pay Bill Online Charge", "debit"), "fee");
  assert.equal(classifyTransactionType("Customer Transfer to JOHN KAMAU 254722000111", "debit"), "send_money");
  assert.equal(classifyTransactionType("Funds received from MARY WANJIRU 254733111222", "credit"), "receive_money");
  assert.equal(classifyTransactionType("Merchant Payment Online to NAIVAS SUPERMARKET", "debit"), "buy_goods");
  assert.equal(classifyTransactionType("Customer Withdrawal at Agent 123456 - JOHN STORE", "debit"), "withdraw");
  assert.equal(classifyTransactionType("Withdrawal Charge", "debit"), "fee");
  assert.equal(classifyTransactionType("Airtime Purchase", "debit"), "airtime");
  assert.equal(classifyTransactionType("Reversal of Pay Bill transaction", "credit"), "reversal");
});

test("falls back to direction when the description doesn't name a known operation", () => {
  assert.equal(classifyTransactionType("Some unrecognized future M-Pesa product", "credit"), "receive_money");
  assert.equal(classifyTransactionType("Some unrecognized future M-Pesa product", "debit"), "other");
});

test("extracts a plausible counterparty name from 'to'/'from' phrasing", () => {
  assert.equal(extractMerchantName("Customer Transfer to JOHN KAMAU 254722000111"), "JOHN KAMAU");
  assert.equal(extractMerchantName("Funds received from MARY WANJIRU 254733111222"), "MARY WANJIRU");
  assert.equal(extractMerchantName("Merchant Payment Online to NAIVAS SUPERMARKET"), "NAIVAS SUPERMARKET");
  assert.equal(extractMerchantName("Pay Bill Online to KPLC PREPAID Acc. 987654321"), "KPLC PREPAID Acc.");
});

test("returns null rather than guessing when there's no clean to/from pattern", () => {
  assert.equal(extractMerchantName("Pay Bill Online Charge"), null);
  assert.equal(extractMerchantName("Withdrawal Charge"), null);
});
