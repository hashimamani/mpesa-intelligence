import { BadRequestException, Injectable } from "@nestjs/common";
import type { SpendingSummaryDTO } from "@mpesa/types";
import { PrismaService } from "../prisma/prisma.service";
import type { OwnerContext } from "../statements/statements.service";
import { monthsBack } from "./period";
import { resolveMonth } from "./resolve-month";
import { computeAndStoreSpendingSummary } from "./summary";

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(owner: OwnerContext, monthParam?: string): Promise<SpendingSummaryDTO> {
    const period = await resolveMonth(this.prisma, owner, monthParam);
    return computeAndStoreSpendingSummary(this.prisma, owner, period);
  }

  async getTrend(owner: OwnerContext, months: number): Promise<SpendingSummaryDTO[]> {
    if (!Number.isInteger(months) || months < 1 || months > 24) {
      throw new BadRequestException("months must be an integer between 1 and 24");
    }
    // A recent-first list of periods would need the caller to reverse it to
    // draw a left-to-right trend chart — return oldest-first directly.
    const anchor = await resolveMonth(this.prisma, owner);
    const periods = monthsBack(months, anchor.periodStart);
    return Promise.all(periods.map((period) => computeAndStoreSpendingSummary(this.prisma, owner, period)));
  }
}
