import type { PrismaService } from "../prisma/prisma.service";
import type { S3Service } from "../storage/s3.service";
import { inspectPdf } from "./pdf-inspector";

/**
 * The real work done at Stage 5: confirm the uploaded document is actually a
 * readable PDF with a text layer. This is deliberately NOT statement
 * extraction — no M-Pesa-specific parsing, no transactions, no categories.
 * That's Stage 6 (docs/06-statement-processing-architecture.md), which picks
 * up from here by adding the next stage transition after `reading_transactions`.
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

  try {
    const bytes = await deps.s3.getObjectBytes(statement.s3Key);

    if (!bytes.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
      throw new Error("not_a_valid_pdf");
    }

    const parsed = await inspectPdf(bytes);
    if (!parsed.numPages || parsed.numPages < 1) {
      throw new Error("pdf_has_no_pages");
    }
    if (!parsed.text || parsed.text.trim().length === 0) {
      // A scanned/image-only statement has no extractable text layer — OCR
      // is explicitly future work (docs/06 §Extraction, "OCR only when
      // necessary"), not something this stage attempts.
      throw new Error("no_extractable_text_layer");
    }

    await deps.prisma.statement.update({
      where: { id: statement.id },
      data: { pageCount: parsed.numPages },
    });
    await deps.prisma.statementProcessingJob.update({
      where: { id: job.id },
      data: { completedAt: new Date() },
    });
    // Deliberately not marking the statement "processed" and not advancing
    // the job stage past reading_transactions — there is no real extraction/
    // categorization/analytics yet for it to have gone through. It stays
    // "processing" until Stage 6 adds the next real step.
  } catch (error) {
    const errorCode = error instanceof Error ? error.message : "unknown_processing_error";
    await deps.prisma.statement.update({ where: { id: statement.id }, data: { status: "failed" } });
    await deps.prisma.statementProcessingJob.update({
      where: { id: job.id },
      data: { completedAt: new Date(), errorCode },
    });
  }
}
