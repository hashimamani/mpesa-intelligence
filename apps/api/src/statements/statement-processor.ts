import type { PrismaService } from "../prisma/prisma.service";
import type { S3Service } from "../storage/s3.service";
import { inspectPdf } from "./pdf-inspector";
import { PARSER_VERSION, parseStatementRows } from "./extraction/mpesa-statement-parser";
import { reconcile } from "./extraction/reconciliation";
import { classifyTransactionType, extractMerchantName } from "./extraction/transaction-classifier";
import { CLASSIFICATION_VERSION, classifyTransaction } from "../categorization/classifier";
import { ensureCategorizationDataSeeded, loadCategoryLookup } from "../categorization/taxonomy-seeder";
import { loadHistoryLookup, loadMerchantLookup } from "../categorization/lookups";

/**
 * Stage 5 confirmed the upload was a real, readable PDF. Stage 6 added the
 * actual extraction: parse the M-Pesa transaction table, reconcile it
 * against the running balance, normalize each row into a Transaction. Stage
 * 7 (this one) adds categorization: every reconciled row also gets a
 * category/subcategory via the layered classifier (docs/06 §Categorization
 * engine) before being persisted. See docs/15-extraction-engine.md and
 * docs/16-categorization-engine.md.
 *
 * Written as a plain function (not a class method) so the BullMQ worker
 * (worker.ts) and tests can both call it directly — tests get deterministic,
 * synchronous-feeling assertions against the real logic instead of polling a
 * live queue.
 */
export async function processStatementJob(
  deps: { prisma: PrismaService; s3: S3Service },
  jobId: string,
): Promise<void> {
  const job = await deps.prisma.statementProcessingJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  const statement = await deps.prisma.statement.findUnique({ where: { id: job.statementId } });
  if (!statement) return;

  await deps.prisma.statementProcessingJob.update({
    where: { id: job.id },
    data: { startedAt: new Date(), stage: "reading_transactions" },
  });
  await deps.prisma.statement.update({ where: { id: statement.id }, data: { status: "processing" } });

  try {
    const bytes = await deps.s3.getObjectBytes(statement.s3Key);

    if (!bytes.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
      throw new Error("not_a_valid_pdf");
    }

    const inspected = await inspectPdf(bytes);
    if (!inspected.numPages || inspected.numPages < 1) {
      throw new Error("pdf_has_no_pages");
    }
    if (!inspected.text || inspected.text.trim().length === 0) {
      // A scanned/image-only statement has no extractable text layer — OCR
      // is explicitly future work (docs/06 §Extraction, "OCR only when
      // necessary"), not something this stage attempts.
      throw new Error("no_extractable_text_layer");
    }

    const { parsed: parsedRows, unparsed, periodStart, periodEnd } = parseStatementRows(inspected.rows, inspected.lines);
    if (parsedRows.length === 0) {
      throw new Error("no_transactions_found");
    }

    // Only "Completed" rows enter the balance-reconciliation chain and
    // become Transactions — a Pending/Failed row shouldn't have moved the
    // running balance, so including it would break delta-based direction
    // inference for every row after it. Still recorded as RawTransaction.
    const completedRows = parsedRows.filter((row) => row.status === "Completed");
    const { transactions: reconciled, issues, confidence } = reconcile(completedRows);

    // Idempotent retry: this job always fully re-derives raw rows from the
    // source PDF, so clearing and reinserting is simpler than (and
    // equivalent to) an upsert here.
    await deps.prisma.rawTransaction.deleteMany({ where: { statementId: statement.id } });
    await deps.prisma.rawTransaction.createMany({
      data: [
        ...parsedRows.map((row) => ({
          statementId: statement.id,
          rowIndex: row.rowIndex,
          rawText: row.raw,
          parsed: row.status === "Completed",
          parseError: row.status !== "Completed" ? `status was "${row.status}", not Completed` : null,
        })),
        ...unparsed.map((row) => ({
          statementId: statement.id,
          rowIndex: row.rowIndex,
          rawText: row.raw,
          parsed: false,
          parseError: row.reason,
        })),
      ],
    });

    // Seeded idempotently (no separate step to remember before a deploy —
    // see taxonomy-seeder.ts), then loaded once for the whole job rather
    // than per row: categories/merchants are small tables, and this owner's
    // correction history is scoped to them specifically.
    await ensureCategorizationDataSeeded(deps.prisma);
    await deps.prisma.statementProcessingJob.update({ where: { id: job.id }, data: { stage: "categorizing" } });
    const [categoryLookup, merchantLookup, historyLookup] = await Promise.all([
      loadCategoryLookup(deps.prisma),
      loadMerchantLookup(deps.prisma),
      loadHistoryLookup(deps.prisma, statement.ownerType, statement.ownerId),
    ]);

    for (const row of reconciled) {
      const transactionType = classifyTransactionType(row.description, row.direction);
      const merchantName = extractMerchantName(row.description);
      const magnitude = row.amount.abs();
      const classification = classifyTransaction(categoryLookup, merchantLookup, historyLookup, {
        transactionType,
        description: row.description,
        merchantName,
      });

      // Matched on referenceNumber + description + amount, not
      // referenceNumber alone — a real statement's receipt number is only
      // unique per real-world transaction, not per row (see the Transaction
      // model's rowIndex doc comment), so a bare referenceNumber match would
      // also catch that transaction's own sibling charge/overdraft rows from
      // the *same* real transaction, misflagging them as cross-statement
      // duplicates of each other.
      const existingElsewhere = await deps.prisma.transaction.findFirst({
        where: {
          ownerType: statement.ownerType,
          ownerId: statement.ownerId,
          referenceNumber: row.referenceNumber,
          description: row.description,
          amount: magnitude.toFixed(2),
          statementId: { not: statement.id },
        },
      });

      // A reprocess (idempotent retry, or any future re-run) must never
      // silently discard a user's own category correction — re-extraction
      // re-derives transactionType/amount/etc. fresh every time, but
      // classification stays whatever the user explicitly set once they've
      // set it, same principle as docs/06 layer 5 "always wins."
      const existingThisRow = await deps.prisma.transaction.findUnique({
        where: { statementId_rowIndex: { statementId: statement.id, rowIndex: row.rowIndex } },
        select: { classificationSource: true, categoryId: true, subcategoryId: true, classificationConfidence: true, merchantId: true },
      });
      const preserveUserCorrection = existingThisRow?.classificationSource === "user_correction";
      const categorization = preserveUserCorrection
        ? {
            merchantId: existingThisRow.merchantId,
            categoryId: existingThisRow.categoryId,
            subcategoryId: existingThisRow.subcategoryId,
            classificationConfidence: existingThisRow.classificationConfidence,
            classificationSource: existingThisRow.classificationSource,
          }
        : {
            merchantId: classification.merchantId,
            categoryId: classification.categoryId,
            subcategoryId: classification.subcategoryId,
            classificationConfidence: classification.confidence,
            classificationSource: classification.source,
          };

      await deps.prisma.transaction.upsert({
        where: { statementId_rowIndex: { statementId: statement.id, rowIndex: row.rowIndex } },
        create: {
          statementId: statement.id,
          ownerType: statement.ownerType,
          ownerId: statement.ownerId,
          rowIndex: row.rowIndex,
          transactionDate: row.transactionDate,
          transactionType,
          direction: row.direction,
          amount: magnitude.toFixed(2),
          balanceAfter: row.balance.toFixed(2),
          description: row.description,
          rawDescription: row.raw,
          merchantName,
          ...categorization,
          referenceNumber: row.referenceNumber,
          isDuplicateOf: existingElsewhere?.id ?? null,
        },
        update: {
          transactionDate: row.transactionDate,
          transactionType,
          direction: row.direction,
          amount: magnitude.toFixed(2),
          balanceAfter: row.balance.toFixed(2),
          description: row.description,
          rawDescription: row.raw,
          merchantName,
          ...categorization,
          isDuplicateOf: existingElsewhere?.id ?? null,
        },
      });
    }

    // Conservative by design: ANY unparsed candidate row or reconciliation
    // mismatch sends the statement to needs_review rather than treating
    // partial extraction as good enough — docs/06 is explicit that low
    // confidence must never be silently accepted for financial data. This
    // threshold has not been calibrated against a real statement (none was
    // available); revisit once one is.
    const needsReview = unparsed.length > 0 || confidence < 1;

    await deps.prisma.statement.update({
      where: { id: statement.id },
      data: {
        status: needsReview ? "needs_review" : "processing",
        pageCount: inspected.numPages,
        periodStart,
        periodEnd,
        parserVersion: PARSER_VERSION,
        classificationVersion: CLASSIFICATION_VERSION,
      },
    });
    await deps.prisma.statementProcessingJob.update({
      where: { id: job.id },
      data: {
        completedAt: new Date(),
        errorCode: needsReview
          ? `needs_review: ${unparsed.length} unparsed row(s), ${issues.length} reconciliation issue(s)`
          : null,
      },
    });
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : "unknown_processing_error";
    await deps.prisma.statement.update({ where: { id: statement.id }, data: { status: "failed" } });
    await deps.prisma.statementProcessingJob.update({
      where: { id: job.id },
      data: { completedAt: new Date(), errorCode },
    });
  }
}
