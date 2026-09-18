import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { CategoryCorrectionInput } from "@mpesa/validation";
import type { TransactionDTO } from "@mpesa/types";
import { PrismaService } from "../prisma/prisma.service";
import type { OwnerContext } from "../statements/statements.service";
import { toTransactionDTO } from "../statements/statements.mapper";
import { calendarMonthOf } from "../analytics/period";
import { resolveMonth } from "../analytics/resolve-month";
import { computeAndStoreSpendingSummary } from "../analytics/summary";

/**
 * Layer 5 of docs/06's categorization design: a user correction always
 * wins, is scoped to the owner, and feeds `categorization/lookups.ts`'s
 * historical-classification layer for that owner's future transactions —
 * never mutates Merchant.defaultCategoryId directly (that's a separate,
 * reviewed aggregate process, not implemented yet).
 */
@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * All of this owner's transactions across every statement for one
   * calendar month — the "Transaction list with manual category
   * correction" MVP screen (docs/01-prd.md) needs a cross-statement view,
   * unlike StatementsService.listTransactions which is scoped to one
   * statement. Defaults to the same "most recent month with activity"
   * behavior as analytics/analytics.service.ts, for consistency between
   * the dashboard and the transaction list.
   */
  async listForMonth(owner: OwnerContext, monthParam?: string): Promise<TransactionDTO[]> {
    const period = await resolveMonth(this.prisma, owner, monthParam);
    const transactions = await this.prisma.transaction.findMany({
      where: {
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        transactionDate: { gte: period.periodStart, lt: period.exclusiveEnd },
      },
      orderBy: { transactionDate: "desc" },
    });
    return transactions.map(toTransactionDTO);
  }

  async correctCategory(owner: OwnerContext, input: CategoryCorrectionInput): Promise<TransactionDTO> {
    // Ownership check and the id both in one query — same tenant-isolation
    // pattern as StatementsService.findOwned: a transaction belonging to
    // someone else must look identical to a nonexistent one.
    const transaction = await this.prisma.transaction.findFirst({
      where: { id: input.transactionId, ownerType: owner.ownerType, ownerId: owner.ownerId },
    });
    if (!transaction) throw new NotFoundException("Transaction not found");

    const chosen = await this.prisma.category.findUnique({ where: { id: input.categoryId } });
    if (!chosen) throw new BadRequestException("Unknown category");

    // The user can pick either a top-level category or a specific
    // subcategory — normalize into the same (categoryId, subcategoryId)
    // pair the automatic classifier produces (classifier.ts's
    // resolveCategoryPair does the identical derivation).
    const categoryId = chosen.parentId ?? chosen.id;
    const subcategoryId = chosen.parentId ? chosen.id : null;

    const [, updated] = await this.prisma.$transaction([
      this.prisma.categoryCorrection.create({
        data: {
          transactionId: transaction.id,
          ownerType: owner.ownerType,
          ownerId: owner.ownerId,
          previousCategoryId: transaction.categoryId,
          newCategoryId: chosen.id,
        },
      }),
      this.prisma.transaction.update({
        where: { id: transaction.id },
        data: {
          categoryId,
          subcategoryId,
          classificationConfidence: 1,
          classificationSource: "user_correction",
        },
      }),
    ]);

    // A correction shifts which category this transaction's amount counts
    // toward — the affected month's SpendingSummary would otherwise stay
    // stale until the next statement upload touches that same month. See
    // analytics/summary.ts's doc comment: recompute on every write, never
    // trust the cache without refreshing it.
    await computeAndStoreSpendingSummary(this.prisma, owner, calendarMonthOf(transaction.transactionDate));

    return toTransactionDTO(updated);
  }
}
