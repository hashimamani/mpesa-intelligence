-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('send_money', 'receive_money', 'pay_bill', 'buy_goods', 'withdraw', 'deposit', 'airtime', 'reversal', 'fee', 'other');

-- CreateEnum
CREATE TYPE "ClassificationSource" AS ENUM ('rule', 'merchant', 'history', 'ai', 'user_correction');

-- CreateTable
CREATE TABLE "raw_transactions" (
    "id" TEXT NOT NULL,
    "statement_id" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "raw_text" TEXT NOT NULL,
    "parsed" BOOLEAN NOT NULL,
    "parse_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "statement_id" TEXT NOT NULL,
    "owner_type" "OwnerType" NOT NULL,
    "owner_id" TEXT NOT NULL,
    "transaction_date" TIMESTAMP(3) NOT NULL,
    "transaction_type" "TransactionType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "fee" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "balance_after" DECIMAL(14,2),
    "description" TEXT NOT NULL,
    "raw_description" TEXT NOT NULL,
    "merchant_name" TEXT,
    "category_id" TEXT,
    "subcategory_id" TEXT,
    "classification_confidence" DOUBLE PRECISION,
    "classification_source" "ClassificationSource",
    "reference_number" TEXT NOT NULL,
    "is_duplicate_of" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "raw_transactions_statement_id_idx" ON "raw_transactions"("statement_id");

-- CreateIndex
CREATE INDEX "transactions_owner_type_owner_id_transaction_date_idx" ON "transactions"("owner_type", "owner_id", "transaction_date");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_statement_id_reference_number_key" ON "transactions"("statement_id", "reference_number");

-- AddForeignKey
ALTER TABLE "raw_transactions" ADD CONSTRAINT "raw_transactions_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_statement_id_fkey" FOREIGN KEY ("statement_id") REFERENCES "statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
