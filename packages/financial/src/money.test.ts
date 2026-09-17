import { test } from "node:test";
import assert from "node:assert/strict";
import { Money, sumMoney } from "./money";

test("adds two amounts exactly, avoiding float drift", () => {
  const a = Money.fromString("0.10");
  const b = Money.fromString("0.20");
  assert.equal(a.add(b).toString(), "0.30");
});

test("rejects combining different currencies", () => {
  const kes = Money.fromString("100.00", "KES");
  const usd = Money.fromString("100.00", "USD");
  assert.throws(() => kes.add(usd));
});

test("sums a list of amounts exactly", () => {
  const amounts = [
    Money.fromString("1000.55"),
    Money.fromString("2499.45"),
    Money.fromString("0.00"),
  ];
  assert.equal(sumMoney(amounts).toString(), "3500.00");
});

test("subtraction and negativity check", () => {
  const spent = Money.fromString("500.00");
  const received = Money.fromString("300.00");
  const net = received.subtract(spent);
  assert.equal(net.toString(), "-200.00");
  assert.equal(net.isNegative(), true);
});

test("zero is exact, not a rounded float", () => {
  const total = sumMoney([]);
  assert.equal(total.isZero(), true);
  assert.equal(total.toString(), "0.00");
});
