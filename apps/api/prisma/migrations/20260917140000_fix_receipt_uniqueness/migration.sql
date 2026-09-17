-- DropIndex
DROP INDEX "transactions_statement_id_reference_number_key";

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "row_index" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "transactions_owner_type_owner_id_reference_number_idx" ON "transactions"("owner_type", "owner_id", "reference_number");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_statement_id_row_index_key" ON "transactions"("statement_id", "row_index");
