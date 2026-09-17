-- CreateEnum
CREATE TYPE "OwnerType" AS ENUM ('user', 'organization');

-- CreateEnum
CREATE TYPE "StatementStatus" AS ENUM ('pending_upload', 'uploaded', 'processing', 'processed', 'failed', 'needs_review');

-- CreateEnum
CREATE TYPE "ProcessingStage" AS ENUM ('uploaded', 'reading_transactions', 'categorizing', 'calculating_analytics', 'generating_insights', 'complete');

-- CreateTable
CREATE TABLE "statements" (
    "id" TEXT NOT NULL,
    "owner_type" "OwnerType" NOT NULL,
    "owner_id" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "StatementStatus" NOT NULL DEFAULT 'pending_upload',
    "document_fingerprint" TEXT,
    "page_count" INTEGER,
    "period_start" DATE,
    "period_end" DATE,
    "parser_version" TEXT,
    "classification_version" TEXT,
    "analytics_version" TEXT,
    "insight_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statement_processing_jobs" (
    "id" TEXT NOT NULL,
    "statement_id" TEXT NOT NULL,
    "stage" "ProcessingStage" NOT NULL DEFAULT 'uploaded',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error_code" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statement_processing_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "statements_s3_key_key" ON "statements"("s3_key");

-- CreateIndex
CREATE INDEX "statements_owner_type_owner_id_idx" ON "statements"("owner_type", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "statements_owner_type_owner_id_document_fingerprint_key" ON "statements"("owner_type", "owner_id", "document_fingerprint");

-- CreateIndex
CREATE INDEX "statement_processing_jobs_statement_id_idx" ON "statement_processing_jobs"("statement_id");

-- AddForeignKey
ALTER TABLE "statement_processing_jobs" ADD CONSTRAINT "statement_processing_jobs_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
