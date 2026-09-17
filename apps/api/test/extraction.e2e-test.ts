import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import PDFDocument from "pdfkit";
import { AppModule } from "../src/app.module";
import { EmailService, type SendEmailInput } from "../src/email/email.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { S3Service } from "../src/storage/s3.service";
import { processStatementJob } from "../src/statements/statement-processor";

/**
 * Exercises the real extraction pipeline (parser -> reconciliation ->
 * normalization -> persistence) against a synthetic M-Pesa statement PDF,
 * against real Postgres/Redis/MinIO — no mocks beyond EmailService (see
 * auth.e2e-test.ts for why that substitution specifically is fine). The
 * fixture is entirely synthetic; no real person's statement is used
 * (docs/09 §Statement fixture testing).
 */
class CapturingEmailService extends EmailService {
  async send(_input: SendEmailInput): Promise<void> {}
}

async function createTestApp(): Promise<{ app: INestApplication; prisma: PrismaService; s3: S3Service }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailService)
    .useValue(new CapturingEmailService())
    .compile();
  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  await app.init();
  return { app, prisma: app.get(PrismaService), s3: app.get(S3Service) };
}

async function registerVerifiedUser(app: INestApplication): Promise<{ accessToken: string; userId: string }> {
  const email = `extract-${randomUUID()}@example.com`;
  const password = "Sup3rSecret99";

  // Read the token straight from the DB rather than the (stubbed) email
  // capture — simpler here since we don't otherwise need the email body.
  const prisma = app.get(PrismaService);
  await request(app.getHttpServer()).post("/auth/register").send({ email, password });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const verification = await prisma.emailVerificationToken.findFirstOrThrow({ where: { userId: user.id } });
  // The token is stored hashed; verifying via the real endpoint needs the raw
  // value, so instead mark it verified directly — equivalent outcome, avoids
  // reaching into TokenService internals just to get a raw token for a test
  // that isn't about the verification flow itself (that's auth.e2e-test.ts's job).
  await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  await prisma.emailVerificationToken.update({ where: { id: verification.id }, data: { usedAt: new Date() } });

  const loginRes = await request(app.getHttpServer()).post("/auth/login").send({ email, password });
  assert.equal(loginRes.status, 200);
  return { accessToken: loginRes.body.accessToken as string, userId: user.id };
}

function row(ref: string, date: string, time: string, description: string, status: string, amount: string, balance: string): string {
  return `${ref} ${date} ${time} ${description} ${status} ${amount} ${balance}`;
}

async function buildStatementPdf(headerLines: string[], rows: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(10);
    for (const line of headerLines) doc.text(line);
    doc.moveDown();
    for (const line of rows) doc.text(line);
    doc.end();
  });
}

async function uploadAndProcess(
  app: INestApplication,
  prisma: PrismaService,
  s3: S3Service,
  accessToken: string,
  pdfBytes: Buffer,
  filename = "statement.pdf",
): Promise<{ statementId: string; jobId: string }> {
  const uploadUrlRes = await request(app.getHttpServer())
    .post("/statements/upload-url")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ filename, contentType: "application/pdf", sizeBytes: pdfBytes.length });
  const { statementId, uploadUrl } = uploadUrlRes.body;

  const putRes = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: pdfBytes });
  assert.equal(putRes.status, 200);

  const confirmRes = await request(app.getHttpServer())
    .post(`/statements/${statementId}/confirm`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send();
  assert.equal(confirmRes.status, 200);

  await processStatementJob({ prisma, s3 }, confirmRes.body.job.id);
  return { statementId, jobId: confirmRes.body.job.id };
}

const HEADER = ["M-PESA STATEMENT", "Customer Name: JANE MUTHONI", "Statement Period: 01/08/2026 - 31/08/2026"];

test("extracts a clean statement into correctly typed, directed, and reconciled transactions", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken, userId } = await registerVerifiedUser(app);
    const rows = [
      row("AA11111111", "2026-08-01", "08:00:00", "Funds received from MARY WANJIRU 254733111222", "Completed", "5000.00", "5000.00"),
      row("AA11111112", "2026-08-02", "09:15:00", "Pay Bill Online to KPLC PREPAID Acc. 987654321", "Completed", "1000.00", "4000.00"),
      row("AA11111113", "2026-08-02", "09:15:05", "Pay Bill Online Charge", "Completed", "22.00", "3978.00"),
      row("AA11111114", "2026-08-03", "14:03:10", "Customer Transfer to JOHN KAMAU 254722000111", "Completed", "500.00", "3478.00"),
      row("AA11111115", "2026-08-04", "12:45:00", "Merchant Payment Online to NAIVAS SUPERMARKET", "Completed", "1250.00", "2228.00"),
    ];
    const pdf = await buildStatementPdf(HEADER, rows);

    const { statementId } = await uploadAndProcess(app, prisma, s3, accessToken, pdf);

    const statementRes = await request(app.getHttpServer())
      .get(`/statements/${statementId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(statementRes.body.statement.status, "processing"); // not needs_review, not failed
    assert.equal(statementRes.body.statement.transactionCount, 5);
    assert.equal(statementRes.body.statement.periodStart, "2026-08-01");
    assert.equal(statementRes.body.statement.periodEnd, "2026-08-31");
    assert.equal(statementRes.body.job.errorCode, null);

    const txRes = await request(app.getHttpServer())
      .get(`/statements/${statementId}/transactions`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(txRes.status, 200);
    const transactions = txRes.body as Array<Record<string, unknown>>;
    assert.equal(transactions.length, 5);

    const received = transactions.find((t) => t.referenceNumber === "AA11111111")!;
    assert.equal(received.direction, "credit");
    assert.equal(received.transactionType, "receive_money");
    assert.deepEqual(received.amount, { amount: "5000.00", currency: "KES" });
    assert.equal(received.merchantName, "MARY WANJIRU");
    assert.equal(received.isDuplicate, false);

    const payBill = transactions.find((t) => t.referenceNumber === "AA11111112")!;
    assert.equal(payBill.transactionType, "pay_bill");
    assert.equal(payBill.direction, "debit");

    const charge = transactions.find((t) => t.referenceNumber === "AA11111113")!;
    assert.equal(charge.transactionType, "fee");

    const buyGoods = transactions.find((t) => t.referenceNumber === "AA11111115")!;
    assert.equal(buyGoods.transactionType, "buy_goods");
    assert.equal(buyGoods.merchantName, "NAIVAS SUPERMARKET");

    // Every persisted transaction is scoped to this owner — a direct DB
    // check, not just trusting the API filtered correctly.
    const dbCount = await prisma.transaction.count({ where: { ownerType: "user", ownerId: userId } });
    assert.equal(dbCount, 5);
  } finally {
    await app.close();
  }
});

test("a broken balance sequence sends the statement to needs_review, not silently accepted", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const rows = [
      row("BB11111111", "2026-08-01", "08:00:00", "Funds received from MARY WANJIRU 254733111222", "Completed", "5000.00", "5000.00"),
      // Balance only moved by 400 but the row claims 500 — inconsistent.
      row("BB11111112", "2026-08-02", "09:15:00", "Customer Transfer to JOHN KAMAU 254722000111", "Completed", "500.00", "4600.00"),
    ];
    const pdf = await buildStatementPdf(HEADER, rows);
    const { statementId } = await uploadAndProcess(app, prisma, s3, accessToken, pdf);

    const statementRes = await request(app.getHttpServer())
      .get(`/statements/${statementId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(statementRes.body.statement.status, "needs_review");
    assert.match(statementRes.body.job.errorCode, /needs_review/);
    // Transactions are still persisted and visible for review — needs_review
    // is a flag, not a silent drop.
    assert.equal(statementRes.body.statement.transactionCount, 2);
  } finally {
    await app.close();
  }
});

test("a statement with no parseable transaction rows fails outright", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const pdf = await buildStatementPdf(["This document has no transaction table at all."], []);
    const { statementId } = await uploadAndProcess(app, prisma, s3, accessToken, pdf);

    const statementRes = await request(app.getHttpServer())
      .get(`/statements/${statementId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(statementRes.body.statement.status, "failed");
    assert.equal(statementRes.body.job.errorCode, "no_transactions_found");
  } finally {
    await app.close();
  }
});

test("the same transaction appearing in two uploaded statements is flagged as a duplicate, not silently double-counted", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const sharedRow = row("CC11111111", "2026-08-01", "08:00:00", "Funds received from MARY WANJIRU 254733111222", "Completed", "5000.00", "5000.00");

    const pdf1 = await buildStatementPdf(HEADER, [sharedRow]);
    const { statementId: firstId } = await uploadAndProcess(app, prisma, s3, accessToken, pdf1, "first.pdf");

    const pdf2 = await buildStatementPdf(HEADER, [
      sharedRow,
      row("CC11111112", "2026-08-02", "09:00:00", "Customer Transfer to JOHN KAMAU 254722000111", "Completed", "500.00", "4500.00"),
    ]);
    const { statementId: secondId } = await uploadAndProcess(app, prisma, s3, accessToken, pdf2, "second.pdf");

    const secondTxRes = await request(app.getHttpServer())
      .get(`/statements/${secondId}/transactions`)
      .set("Authorization", `Bearer ${accessToken}`);
    const duplicateRow = (secondTxRes.body as Array<Record<string, unknown>>).find(
      (t) => t.referenceNumber === "CC11111111",
    )!;
    assert.equal(duplicateRow.isDuplicate, true);

    const firstTxRes = await request(app.getHttpServer())
      .get(`/statements/${firstId}/transactions`)
      .set("Authorization", `Bearer ${accessToken}`);
    const originalRow = (firstTxRes.body as Array<Record<string, unknown>>).find(
      (t) => t.referenceNumber === "CC11111111",
    )!;
    assert.equal(originalRow.isDuplicate, false);
  } finally {
    await app.close();
  }
});

test("reprocessing the same job is idempotent — no duplicate transactions on retry", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const rows = [
      row("DD11111111", "2026-08-01", "08:00:00", "Funds received from MARY WANJIRU 254733111222", "Completed", "5000.00", "5000.00"),
      row("DD11111112", "2026-08-02", "09:00:00", "Customer Transfer to JOHN KAMAU 254722000111", "Completed", "500.00", "4500.00"),
    ];
    const pdf = await buildStatementPdf(HEADER, rows);
    const { statementId, jobId } = await uploadAndProcess(app, prisma, s3, accessToken, pdf);

    const countAfterFirst = await prisma.transaction.count({ where: { statementId } });
    await processStatementJob({ prisma, s3 }, jobId); // simulate a retry
    const countAfterRetry = await prisma.transaction.count({ where: { statementId } });

    assert.equal(countAfterFirst, 2);
    assert.equal(countAfterRetry, 2);

    const rawCount = await prisma.rawTransaction.count({ where: { statementId } });
    assert.equal(rawCount, 2); // not duplicated either
  } finally {
    await app.close();
  }
});

test("tenant isolation holds for the transactions endpoint", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const userA = await registerVerifiedUser(app);
    const userB = await registerVerifiedUser(app);
    const pdf = await buildStatementPdf(HEADER, [
      row("EE11111111", "2026-08-01", "08:00:00", "Funds received from MARY WANJIRU 254733111222", "Completed", "5000.00", "5000.00"),
    ]);
    const { statementId } = await uploadAndProcess(app, prisma, s3, userA.accessToken, pdf);

    const crossRes = await request(app.getHttpServer())
      .get(`/statements/${statementId}/transactions`)
      .set("Authorization", `Bearer ${userB.accessToken}`);
    assert.equal(crossRes.status, 404);
  } finally {
    await app.close();
  }
});
