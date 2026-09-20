import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import type { StatementUploadInput } from "@mpesa/validation";
import type { StatementWithJobDTO, UploadUrlResponseDTO, StatementDTO, TransactionDTO } from "@mpesa/types";
import { PrismaService } from "../prisma/prisma.service";
import { S3Service } from "../storage/s3.service";
import { StatementProcessingQueue } from "../queue/statement-processing.queue";
import { toJobDTO, toStatementDTO, toTransactionDTO } from "./statements.mapper";

export interface OwnerContext {
  ownerType: "user" | "organization";
  ownerId: string;
}

@Injectable()
export class StatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly queue: StatementProcessingQueue,
  ) {}

  async requestUploadUrl(owner: OwnerContext, input: StatementUploadInput): Promise<UploadUrlResponseDTO> {
    const s3Key = `statements/${owner.ownerType}/${owner.ownerId}/${randomUUID()}.pdf`;

    const statement = await this.prisma.statement.create({
      data: {
        ownerType: owner.ownerType,
        ownerId: owner.ownerId,
        s3Key,
        originalFilename: input.filename,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        status: "pending_upload",
      },
    });

    const { url, expiresAt } = await this.s3.createPresignedUploadUrl(s3Key, input.contentType);

    return { statementId: statement.id, uploadUrl: url, expiresAt: expiresAt.toISOString() };
  }

  async confirmUpload(owner: OwnerContext, statementId: string): Promise<StatementWithJobDTO> {
    const statement = await this.findOwned(owner, statementId);

    if (statement.status !== "pending_upload") {
      throw new BadRequestException(`This statement is already ${statement.status} — it can't be confirmed again`);
    }

    const head = await this.s3.headObject(statement.s3Key);
    if (!head) {
      throw new BadRequestException("Upload not found — make sure the file finished uploading before confirming");
    }
    if (head.sizeBytes !== statement.sizeBytes) {
      throw new BadRequestException(
        `Uploaded file size (${head.sizeBytes} bytes) doesn't match what was declared (${statement.sizeBytes} bytes)`,
      );
    }

    // Every upload is treated as a new statement — re-uploading the exact
    // same file (e.g. retrying one that previously failed) is never
    // blocked. documentFingerprint is still recorded for reference, but
    // isn't unique-constrained: duplicate *transactions* are what actually
    // matter, and those are caught individually and precisely at the
    // transaction level (isDuplicateOf, matched on referenceNumber +
    // description + amount — see docs/15-extraction-engine.md), which is
    // strictly better than blocking a whole re-upload ever was.
    const updated = await this.prisma.statement.update({
      where: { id: statement.id },
      data: { status: "uploaded", documentFingerprint: head.etag },
    });

    const job = await this.prisma.statementProcessingJob.create({
      data: { statementId: updated.id, stage: "uploaded" },
    });

    await this.queue.enqueue({ statementId: updated.id, jobId: job.id });

    return { statement: toStatementDTO(updated, 0), job: toJobDTO(job) };
  }

  async getStatement(owner: OwnerContext, statementId: string): Promise<StatementWithJobDTO> {
    const statement = await this.findOwned(owner, statementId);
    const [job, transactionCount] = await Promise.all([
      this.prisma.statementProcessingJob.findFirst({
        where: { statementId: statement.id },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.transaction.count({ where: { statementId: statement.id } }),
    ]);
    return { statement: toStatementDTO(statement, transactionCount), job: job ? toJobDTO(job) : null };
  }

  async listStatements(owner: OwnerContext): Promise<StatementDTO[]> {
    const statements = await this.prisma.statement.findMany({
      where: { ownerType: owner.ownerType, ownerId: owner.ownerId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { transactions: true } } },
    });
    return statements.map((s) => toStatementDTO(s, s._count.transactions));
  }

  async listTransactions(owner: OwnerContext, statementId: string): Promise<TransactionDTO[]> {
    await this.findOwned(owner, statementId); // ownership check before exposing anything
    const transactions = await this.prisma.transaction.findMany({
      where: { statementId, ownerType: owner.ownerType, ownerId: owner.ownerId },
      orderBy: { transactionDate: "asc" },
    });
    return transactions.map(toTransactionDTO);
  }

  private async findOwned(owner: OwnerContext, statementId: string) {
    // Both the id AND the owner filter are in the same query — the two-step
    // "find then check owner" pattern is exactly the bug docs/04-database-erd.md's
    // tenant-isolation rule exists to prevent (an easy-to-miss branch where the
    // ownership check is forgotten). A statement belonging to someone else
    // looks identical to a nonexistent one — 404, not 403, avoids confirming
    // to a caller that a given ID exists at all.
    const statement = await this.prisma.statement.findFirst({
      where: { id: statementId, ownerType: owner.ownerType, ownerId: owner.ownerId, deletedAt: null },
    });
    if (!statement) throw new NotFoundException("Statement not found");
    return statement;
  }
}
