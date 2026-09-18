import type { PrismaService } from "../prisma/prisma.service";
import type { OwnerType } from "@prisma/client";
import { historyKeyFor, type HistoryLookup, type MerchantLookup } from "./classifier";

/** All merchants, loaded once per job — the table is small (a curated seed
 * list plus whatever future `learned` promotion adds), so an in-memory
 * substring scan per transaction is simpler and fast enough rather than a
 * per-row DB query. */
export async function loadMerchantLookup(prisma: PrismaService): Promise<MerchantLookup> {
  return prisma.merchant.findMany({ select: { id: true, normalizedName: true, defaultCategoryId: true } });
}

/**
 * This owner's correction history, keyed the same way classifyTransaction
 * looks it up (normalized merchantName, falling back to normalized
 * description) — layer 3 of docs/06's categorization design: "has this
 * owner classified this exact merchant/description before?" Ordered
 * oldest-first so a later correction naturally overwrites an earlier one
 * for the same key when both exist.
 */
export async function loadHistoryLookup(prisma: PrismaService, ownerType: OwnerType, ownerId: string): Promise<HistoryLookup> {
  const corrections = await prisma.categoryCorrection.findMany({
    where: { ownerType, ownerId },
    orderBy: { createdAt: "asc" },
    include: { transaction: { select: { merchantName: true, description: true } } },
  });

  const history: HistoryLookup = new Map();
  for (const correction of corrections) {
    const key = historyKeyFor(correction.transaction.merchantName, correction.transaction.description);
    history.set(key, correction.newCategoryId);
  }
  return history;
}
