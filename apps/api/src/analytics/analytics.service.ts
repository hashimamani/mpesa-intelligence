import { BadRequestException, Injectable } from "@nestjs/common";
import type { SpendingSummaryDTO } from "@mpesa/types";
import { PrismaService } from "../prisma/prisma.service";
import type { OwnerContext } from "../statements/statements.service";
import { calendarMonthOf, monthsBack, parseMonthParam, type CalendarMonth } from "./period";
import { computeAndStoreSpendingSummary } from "./summary";

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(owner: OwnerContext, monthParam?: string): Promise<SpendingSummaryDTO> {
    const period = monthParam ? this.requireMonth(monthParam) : await this.defaultMonth(owner);
    return computeAndStoreSpendingSummary(this.prisma, owner, period);
  }

  async getTrend(owner: OwnerContext, months: number): Promise<SpendingSummaryDTO[]> {
    if (!Number.isInteger(months) || months < 1 || months > 24) {
      throw new BadRequestException("months must be an integer between 1 and 24");
    }
    // A recent-first list of periods would need the caller to reverse it to
    // draw a left-to-right trend chart — return oldest-first directly.
    const periods = monthsBack(months, (await this.defaultMonth(owner)).periodStart);
    return Promise.all(periods.map((period) => computeAndStoreSpendingSummary(this.prisma, owner, period)));
  }

  private requireMonth(raw: string): CalendarMonth {
    const parsed = parseMonthParam(raw);
    if (!parsed) throw new BadRequestException('month must be in "YYYY-MM" format');
    return parsed;
  }

  /** No month given: defaults to the most recent calendar month this owner
   * actually has a transaction in — not the real-world current month, which
   * would show an empty dashboard for the common case of uploading a past
   * statement (see the "aha moment" requirement in docs/02). An owner with
   * no transactions at all falls back to the real current month, which is
   * correctly all-zero (a genuine empty state, not a wrong one). */
  private async defaultMonth(owner: OwnerContext): Promise<CalendarMonth> {
    const latest = await this.prisma.transaction.findFirst({
      where: { ownerType: owner.ownerType, ownerId: owner.ownerId },
      orderBy: { transactionDate: "desc" },
      select: { transactionDate: true },
    });
    return calendarMonthOf(latest?.transactionDate ?? new Date());
  }
}
