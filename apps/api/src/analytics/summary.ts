import { Decimal } from "decimal.js";
import type { Prisma, OwnerType } from "@prisma/client";
import type { Money, SpendingSummaryDTO } from "@mpesa/types";
import type { PrismaService } from "../prisma/prisma.service";
import { ensureCategorizationDataSeeded } from "../categorization/taxonomy-seeder";
import { ANALYTICS_VERSION, formatDateOnly, type CalendarMonth } from "./period";

export { ANALYTICS_VERSION };

function toMoney(value: Decimal | null | undefined): Money {
  return { amount: (value ?? new Decimal(0)).toFixed(2), currency: "KES" };
}

export interface Owner {
  ownerType: OwnerType;
  ownerId: string;
}

/**
 * Computes a fresh SpendingSummaryDTO for one calendar month, straight from
 * `Transaction` — never reads the `spending_summaries` cache table, only
 * ever recomputes it (see the model's own doc comment for why: a stale
 * cached money figure shown to a user is the exact trust failure docs/10
 * warns about). "Spending" is the taxonomy's own top-level category
 * (categorization/taxonomy.ts) resolved by slug, not hardcoded — if the
 * taxonomy hasn't been seeded yet (e.g. no statement has ever been
 * processed for anyone), it's seeded here defensively so a fresh
 * deployment's first `/analytics/summary` call still works correctly.
 */
export async function computeSpendingSummary(
  prisma: PrismaService,
  owner: Owner,
  period: CalendarMonth,
): Promise<SpendingSummaryDTO> {
  await ensureCategorizationDataSeeded(prisma);
  const spendingCategory = await prisma.category.findUnique({ where: { slug: "spending" } });

  const baseWhere = {
    ownerType: owner.ownerType,
    ownerId: owner.ownerId,
    transactionDate: { gte: period.periodStart, lt: period.exclusiveEnd },
    // A cross-statement duplicate is kept visible for review, but must
    // never double-count in totals — see docs/15's duplicate detection.
    isDuplicateOf: null,
  } satisfies Prisma.TransactionWhereInput;

  const [receivedAgg, movedOutAgg, feesAgg] = await Promise.all([
    prisma.transaction.aggregate({ where: { ...baseWhere, direction: "credit" }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { ...baseWhere, direction: "debit" }, _sum: { amount: true } }),
    prisma.transaction.aggregate({ where: { ...baseWhere, transactionType: "fee" }, _sum: { amount: true } }),
  ]);

  let byCategory: SpendingSummaryDTO["byCategory"] = [];
  let topMerchants: SpendingSummaryDTO["topMerchants"] = [];
  let totalSpent = new Decimal(0);

  if (spendingCategory) {
    const spendingWhere = { ...baseWhere, direction: "debit", categoryId: spendingCategory.id } satisfies Prisma.TransactionWhereInput;

    const [byCategoryGroups, merchantGroups] = await Promise.all([
      prisma.transaction.groupBy({ by: ["subcategoryId"], where: spendingWhere, _sum: { amount: true } }),
      prisma.transaction.groupBy({
        by: ["merchantName"],
        where: { ...spendingWhere, merchantName: { not: null } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    const subcategoryIds = byCategoryGroups.map((g) => g.subcategoryId).filter((id): id is string => id !== null);
    const subcategories = subcategoryIds.length
      ? await prisma.category.findMany({ where: { id: { in: subcategoryIds } } })
      : [];
    const nameById = new Map(subcategories.map((c) => [c.id, c.name]));

    byCategory = byCategoryGroups
      .filter((g): g is typeof g & { subcategoryId: string } => g.subcategoryId !== null)
      .map((g) => ({
        categoryId: g.subcategoryId,
        categoryName: nameById.get(g.subcategoryId) ?? "Unknown",
        total: toMoney(g._sum.amount),
      }))
      .sort((a, b) => Number(b.total.amount) - Number(a.total.amount));

    totalSpent = byCategoryGroups.reduce((sum, g) => sum.plus(g._sum.amount ?? new Decimal(0)), new Decimal(0));

    topMerchants = merchantGroups
      .filter((g): g is typeof g & { merchantName: string } => g.merchantName !== null)
      .map((g) => ({ merchantName: g.merchantName, total: toMoney(g._sum.amount), transactionCount: g._count._all }))
      .sort((a, b) => Number(b.total.amount) - Number(a.total.amount))
      .slice(0, 10);
  }

  const received = receivedAgg._sum.amount ?? new Decimal(0);
  const movedOut = movedOutAgg._sum.amount ?? new Decimal(0);

  return {
    periodStart: formatDateOnly(period.periodStart),
    periodEnd: formatDateOnly(period.periodEnd),
    totalReceived: toMoney(received),
    totalSpent: toMoney(totalSpent),
    totalFees: toMoney(feesAgg._sum.amount),
    netMovement: toMoney(received.minus(movedOut)),
    byCategory,
    topMerchants,
  };
}

/** Upserts the cache row — write-through only, never read back directly by
 * this module (see computeSpendingSummary's doc comment). Keyed on
 * (owner, periodStart, periodEnd), which is stable for a given calendar
 * month regardless of how many times it's recomputed. */
export async function storeSpendingSummary(
  prisma: PrismaService,
  owner: Owner,
  period: CalendarMonth,
  content: SpendingSummaryDTO,
): Promise<void> {
  const totalsJson = content as unknown as Prisma.InputJsonValue;
  await prisma.spendingSummary.upsert({
    where: {
      ownerType_ownerId_periodStart_periodEnd: {
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
      },
    },
    create: {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      totalsJson,
      analyticsVersion: ANALYTICS_VERSION,
    },
    update: { totalsJson, analyticsVersion: ANALYTICS_VERSION },
  });
}

export async function computeAndStoreSpendingSummary(
  prisma: PrismaService,
  owner: Owner,
  period: CalendarMonth,
): Promise<SpendingSummaryDTO> {
  const content = await computeSpendingSummary(prisma, owner, period);
  await storeSpendingSummary(prisma, owner, period, content);
  return content;
}
