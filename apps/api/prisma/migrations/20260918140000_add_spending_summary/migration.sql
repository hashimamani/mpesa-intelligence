-- CreateTable
CREATE TABLE "spending_summaries" (
    "id" TEXT NOT NULL,
    "owner_type" "OwnerType" NOT NULL,
    "owner_id" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "totals_json" JSONB NOT NULL,
    "analytics_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spending_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "spending_summaries_owner_type_owner_id_period_start_period__key" ON "spending_summaries"("owner_type", "owner_id", "period_start", "period_end");

