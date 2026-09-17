import Decimal from "decimal.js";

/**
 * The only type allowed to represent a monetary value anywhere in this codebase.
 * Never use `number`/`float` for money — see docs/03-architecture.md §Money handling.
 * Backed by decimal.js so arithmetic never touches IEEE-754 floating point.
 */
export class Money {
  private readonly value: Decimal;
  public readonly currency: string;

  private constructor(value: Decimal, currency: string) {
    this.value = value;
    this.currency = currency;
  }

  static fromString(amount: string, currency = "KES"): Money {
    return new Money(new Decimal(amount), currency);
  }

  /** For values already known to be exact integers of the minor unit (e.g. cents), if ever needed. */
  static zero(currency = "KES"): Money {
    return new Money(new Decimal(0), currency);
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(
        `Cannot combine amounts in different currencies: ${this.currency} vs ${other.currency}`,
      );
    }
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  compareTo(other: Money): number {
    this.assertSameCurrency(other);
    return this.value.comparedTo(other.value);
  }

  /** Exact decimal string, always 2 decimal places, safe for storage/wire transfer. */
  toString(): string {
    return this.value.toFixed(2);
  }

  toDTO(): { amount: string; currency: string } {
    return { amount: this.toString(), currency: this.currency };
  }
}

export function sumMoney(amounts: Money[], currency = "KES"): Money {
  return amounts.reduce((total, m) => total.add(m), Money.zero(currency));
}
