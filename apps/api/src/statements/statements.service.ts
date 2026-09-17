import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { StatementUploadInput } from "@mpesa/validation";
import type { StatementWithJobDTO, UploadUrlResponseDTO, StatementDTO } from "@mpesa/types";
import { PrismaService } from "../prisma/prisma.service";
import { S3Service } from "../storage/s3.service";
import { StatementProcessingQueue } from "../queue/statement-processing.queue";
import { toJobDTO, toStatementDTO } from "./statements.mapper";

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

    let updated;
    try {
      updated = await this.prisma.statement.update({
        where: { id: statement.id },
        data: { status: "uploaded", documentFingerprint: head.etag },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("You've already uploaded this exact statement");
      }
      throw error;
    }

    const job = await this.prisma.statementProcessingJob.create({
      data: { statementId: updated.id, stage: "uploaded" },
    });

    await this.queue.enqueue({ statementId: updated.id, jobId: job.id });

    return { statement: toStatementDTO(updated), job: toJobDTO(job) };
  }

  async getStatement(owner: OwnerContext, statementId: string): Promise<StatementWithJobDTO> {
    const statement = await this.findOwned(owner, statementId);
    const job = await this.prisma.statementProcessingJob.findFirst({
      where: { statementId: statement.id },
      orderBy: { createdAt: "desc" },
    });
    return { statement: toStatementDTO(statement), job: job ? toJobDTO(job) : null };
  }

  async listStatements(owner: OwnerContext): Promise<StatementDTO[]> {
    const statements = await this.prisma.statement.findMany({
      where: { ownerType: owner.ownerType, ownerId: owner.ownerId, deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return statements.map(toStatementDTO);
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
