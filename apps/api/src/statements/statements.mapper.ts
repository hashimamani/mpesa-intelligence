import type { Statement, StatementProcessingJob } from "@prisma/client";
import type { StatementDTO, StatementProcessingJobDTO } from "@mpesa/types";

export function toStatementDTO(statement: Statement): StatementDTO {
  return {
    id: statement.id,
    ownerType: statement.ownerType,
    status: statement.status,
    originalFilename: statement.originalFilename,
    pageCount: statement.pageCount,
    periodStart: statement.periodStart?.toISOString().slice(0, 10) ?? null,
    periodEnd: statement.periodEnd?.toISOString().slice(0, 10) ?? null,
    createdAt: statement.createdAt.toISOString(),
  };
}

export function toJobDTO(job: StatementProcessingJob): StatementProcessingJobDTO {
  return {
    id: job.id,
    statementId: job.statementId,
    stage: job.stage,
    errorCode: job.errorCode,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}
