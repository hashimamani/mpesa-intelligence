import type { Statement, StatementProcessingJob, Transaction } from "@prisma/client";
import type { StatementDTO, StatementProcessingJobDTO, TransactionDTO } from "@mpesa/types";

export function toStatementDTO(statement: Statement, transactionCount: number): StatementDTO {
  return {
    id: statement.id,
    ownerType: statement.ownerType,
    status: statement.status,
    originalFilename: statement.originalFilename,
    pageCount: statement.pageCount,
    periodStart: statement.periodStart?.toISOString().slice(0, 10) ?? null,
    periodEnd: statement.periodEnd?.toISOString().slice(0, 10) ?? null,
    transactionCount,
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

export function toTransactionDTO(transaction: Transaction): TransactionDTO {
  return {
    id: transaction.id,
    statementId: transaction.statementId,
    transactionDate: transaction.transactionDate.toISOString(),
    transactionType: transaction.transactionType,
    direction: transaction.direction,
    amount: { amount: transaction.amount.toFixed(2), currency: "KES" },
    fee: { amount: transaction.fee.toFixed(2), currency: "KES" },
    balanceAfter: transaction.balanceAfter ? { amount: transaction.balanceAfter.toFixed(2), currency: "KES" } : null,
    description: transaction.description,
    merchantName: transaction.merchantName,
    categoryId: transaction.categoryId,
    subcategoryId: transaction.subcategoryId,
    classificationConfidence: transaction.classificationConfidence,
    classificationSource: transaction.classificationSource,
    referenceNumber: transaction.referenceNumber,
    isDuplicate: transaction.isDuplicateOf !== null,
  };
}
