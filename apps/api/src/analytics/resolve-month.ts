import { BadRequestException } from "@nestjs/common";
import type { OwnerType } from "@prisma/client";
import type { PrismaService } from "../prisma/prisma.service";
import { calendarMonthOf, parseMonthParam, type CalendarMonth } from "./period";

/**
 * Shared "which month did the caller mean" resolution — used by both
 * AnalyticsService (the dashboard's summary/trend) and TransactionsService
 * (the transaction list), so a month picked on one screen means the exact
 * same period on the other. An explicit `monthParam` must be well-formed
 * ("YYYY-MM") or this throws; omitted, it defaults to the most recent
 * calendar month this owner actually has a transaction in — not the real-
 * world current month, which would show an empty screen after uploading a
 * past statement (docs/02's "aha moment").
 */
export async function resolveMonth(
  prisma: PrismaService,
  owner: { ownerType: OwnerType; ownerId: string },
  monthParam?: string,
): Promise<CalendarMonth> {
  if (monthParam) {
    const parsed = parseMonthParam(monthParam);
    if (!parsed) throw new BadRequestException('month must be in "YYYY-MM" format');
    return parsed;
  }

  const latest = await prisma.transaction.findFirst({
    where: { ownerType: owner.ownerType, ownerId: owner.ownerId },
    orderBy: { transactionDate: "desc" },
    select: { transactionDate: true },
  });
  return calendarMonthOf(latest?.transactionDate ?? new Date());
}
