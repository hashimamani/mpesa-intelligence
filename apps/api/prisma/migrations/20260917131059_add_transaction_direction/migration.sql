/*
  Warnings:

  - Added the required column `direction` to the `transactions` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "TransactionDirection" AS ENUM ('credit', 'debit');

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "direction" "TransactionDirection" NOT NULL;
