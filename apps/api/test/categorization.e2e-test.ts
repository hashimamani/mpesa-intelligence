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
 * Exercises Stage 7's categorization engine through the real pipeline
 * (extraction -> classification -> persistence) against real Postgres/
 * Redis/MinIO, plus the correction endpoint (layer 5) and the historical-
 * classification feedback loop it feeds (layer 3) — see
 * docs/16-categorization-engine.md.
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
  const email = `categorize-${randomUUID()}@example.com`;
  const password = "Sup3rSecret99";
  const prisma = app.get(PrismaService);
  await request(app.getHttpServer()).post("/auth/register").send({ email, password });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const verification = await prisma.emailVerificationToken.findFirstOrThrow({ where: { userId: user.id } });
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
    const doc = new PDFDocument({ margin: 40, layout: "landscape", size: "A4" });
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
): Promise<{ statementId: string }> {
  const uploadUrlRes = await request(app.getHttpServer())
    .post("/statements/upload-url")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ filename: "statement.pdf", contentType: "application/pdf", sizeBytes: pdfBytes.length });
  const { statementId, uploadUrl } = uploadUrlRes.body;

  const putRes = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: pdfBytes });
  assert.equal(putRes.status, 200);

  const confirmRes = await request(app.getHttpServer())
    .post(`/statements/${statementId}/confirm`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send();
  assert.equal(confirmRes.status, 200);

  await processStatementJob({ prisma, s3 }, confirmRes.body.job.id);
  return { statementId };
}

const HEADER = ["M-PESA STATEMENT", "Customer Name: JANE MUTHONI", "Statement Period: 01 Aug 2026 - 31 Aug 2026"];

async function categoryIdBySlug(prisma: PrismaService, slug: string): Promise<string> {
  const category = await prisma.category.findUniqueOrThrow({ where: { slug } });
  return category.id;
}

test("assigns categories via the deterministic rule layer for unambiguous transaction types", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const rows = [
      row("AA11111111", "2026-08-01", "08:00:00", "Airtime Purchase", "Completed", "-100.00", "4900.00"),
      row("AA11111112", "2026-08-02", "09:00:00", "Customer Withdrawal at Agent 123456", "Completed", "-500.00", "4400.00"),
      row("AA11111113", "2026-08-03", "10:00:00", "Customer Transfer to 254722000111 - JOHN KAMAU", "Completed", "-1000.00", "3400.00"),
      row("AA11111114", "2026-08-04", "11:00:00", "Funds received from 254733111222 - MARY WANJIRU", "Completed", "2000.00", "5400.00"),
    ];
    const pdf = await buildStatementPdf(HEADER, rows);
    const { statementId } = await uploadAndProcess(app, prisma, s3, accessToken, pdf);

    const statementRes = await request(app.getHttpServer())
      .get(`/statements/${statementId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(statementRes.body.statement.status, "processed");

    const stored = await prisma.statement.findUniqueOrThrow({ where: { id: statementId } });
    assert.equal(stored.classificationVersion, "mpesa-categorization-v1");

    const txRes = await request(app.getHttpServer())
      .get(`/statements/${statementId}/transactions`)
      .set("Authorization", `Bearer ${accessToken}`);
    const transactions = txRes.body as Array<Record<string, unknown>>;

    const airtimeId = await categoryIdBySlug(prisma, "spending");
    const airtimeSubId = await categoryIdBySlug(prisma, "spending.airtime");
    const airtime = transactions.find((t) => t.referenceNumber === "AA11111111")!;
    assert.equal(airtime.categoryId, airtimeId);
    assert.equal(airtime.subcategoryId, airtimeSubId);
    assert.equal(airtime.classificationSource, "rule");

    const withdraw = transactions.find((t) => t.referenceNumber === "AA11111112")!;
    assert.equal(withdraw.subcategoryId, await categoryIdBySlug(prisma, "cash.withdrawal"));

    const sent = transactions.find((t) => t.referenceNumber === "AA11111113")!;
    assert.equal(sent.subcategoryId, await categoryIdBySlug(prisma, "transfers.sent"));

    const received = transactions.find((t) => t.referenceNumber === "AA11111114")!;
    assert.equal(received.subcategoryId, await categoryIdBySlug(prisma, "transfers.received"));
  } finally {
    await app.close();
  }
});

test("merchant recognition (layer 2) overrides the rule layer's low-confidence default for pay_bill/buy_goods", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const rows = [
      row("BB11111111", "2026-08-01", "08:00:00", "Merchant Payment Online to 5509416 - NAIVAS SUPERMARKET", "Completed", "-1500.00", "3500.00"),
      row("BB11111112", "2026-08-02", "09:00:00", "Pay Bill Online to 522533 - KPLC PREPAID Acc. 987654321", "Completed", "-800.00", "2700.00"),
    ];
    const pdf = await buildStatementPdf(HEADER, rows);
    const { statementId } = await uploadAndProcess(app, prisma, s3, accessToken, pdf);

    const txRes = await request(app.getHttpServer())
      .get(`/statements/${statementId}/transactions`)
      .set("Authorization", `Bearer ${accessToken}`);
    const transactions = txRes.body as Array<Record<string, unknown>>;

    const naivas = transactions.find((t) => t.referenceNumber === "BB11111111")!;
    assert.equal(naivas.subcategoryId, await categoryIdBySlug(prisma, "spending.food"));
    assert.equal(naivas.classificationSource, "merchant");

    const kplc = transactions.find((t) => t.referenceNumber === "BB11111112")!;
    assert.equal(kplc.subcategoryId, await categoryIdBySlug(prisma, "spending.bills"));
    assert.equal(kplc.classificationSource, "merchant");
  } finally {
    await app.close();
  }
});

test("Fuliza/overdraft description resolves to Loans even though TransactionType doesn't distinguish it", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const rows = [row("CC11111111", "2026-08-01", "08:00:00", "OverDraft of Credit Party", "Completed", "-50.00", "4950.00")];
    const pdf = await buildStatementPdf(HEADER, rows);
    const { statementId } = await uploadAndProcess(app, prisma, s3, accessToken, pdf);

    const txRes = await request(app.getHttpServer())
      .get(`/statements/${statementId}/transactions`)
      .set("Authorization", `Bearer ${accessToken}`);
    const transaction = (txRes.body as Array<Record<string, unknown>>)[0]!;
    assert.equal(transaction.subcategoryId, await categoryIdBySlug(prisma, "loans.repayment"));
  } finally {
    await app.close();
  }
});

test("a user correction (layer 5) always wins, and feeds this owner's future transactions with the same merchant (layer 3)", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken, userId } = await registerVerifiedUser(app);

    // First statement: a NAIVAS purchase auto-classifies to the global
    // merchant default (Food & Dining).
    const firstPdf = await buildStatementPdf(HEADER, [
      row("DD11111111", "2026-08-01", "08:00:00", "Merchant Payment Online to 5509416 - NAIVAS SUPERMARKET", "Completed", "-1500.00", "3500.00"),
    ]);
    const { statementId: firstStatementId } = await uploadAndProcess(app, prisma, s3, accessToken, firstPdf);
    const firstTxRes = await request(app.getHttpServer())
      .get(`/statements/${firstStatementId}/transactions`)
      .set("Authorization", `Bearer ${accessToken}`);
    const firstTransaction = (firstTxRes.body as Array<Record<string, unknown>>)[0]!;
    assert.equal(firstTransaction.subcategoryId, await categoryIdBySlug(prisma, "spending.food"));

    // This user actually treats this NAIVAS run as household shopping, not
    // food — correct it.
    const shoppingCategoryId = await categoryIdBySlug(prisma, "spending.shopping");
    const correctionRes = await request(app.getHttpServer())
      .post("/transactions/category-corrections")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ transactionId: firstTransaction.id, categoryId: shoppingCategoryId });
    assert.equal(correctionRes.status, 201);
    assert.equal(correctionRes.body.subcategoryId, shoppingCategoryId);
    assert.equal(correctionRes.body.classificationSource, "user_correction");

    const correctionRow = await prisma.categoryCorrection.findFirstOrThrow({ where: { transactionId: firstTransaction.id as string } });
    assert.equal(correctionRow.newCategoryId, shoppingCategoryId);
    assert.equal(correctionRow.ownerId, userId);

    // A second, separate statement with another NAIVAS transaction should
    // now auto-classify to the CORRECTED category (history), not the
    // global merchant default — this is the actual point of layer 3.
    const secondPdf = await buildStatementPdf(HEADER, [
      row("DD11111112", "2026-09-01", "08:00:00", "Merchant Payment Online to 5509416 - NAIVAS SUPERMARKET", "Completed", "-900.00", "2600.00"),
    ]);
    const { statementId: secondStatementId } = await uploadAndProcess(app, prisma, s3, accessToken, secondPdf);
    const secondTxRes = await request(app.getHttpServer())
      .get(`/statements/${secondStatementId}/transactions`)
      .set("Authorization", `Bearer ${accessToken}`);
    const secondTransaction = (secondTxRes.body as Array<Record<string, unknown>>)[0]!;
    assert.equal(secondTransaction.subcategoryId, shoppingCategoryId);
    assert.equal(secondTransaction.classificationSource, "history");
  } finally {
    await app.close();
  }
});

test("reprocessing a statement never silently discards a user's own category correction", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const pdf = await buildStatementPdf(HEADER, [
      row("EE11111111", "2026-08-01", "08:00:00", "Airtime Purchase", "Completed", "-100.00", "4900.00"),
    ]);
    const uploadUrlRes = await request(app.getHttpServer())
      .post("/statements/upload-url")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ filename: "statement.pdf", contentType: "application/pdf", sizeBytes: pdf.length });
    const { statementId, uploadUrl } = uploadUrlRes.body;
    await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: pdf });
    const confirmRes = await request(app.getHttpServer())
      .post(`/statements/${statementId}/confirm`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send();
    const jobId = confirmRes.body.job.id as string;

    await processStatementJob({ prisma, s3 }, jobId);
    const txRes = await request(app.getHttpServer())
      .get(`/statements/${statementId}/transactions`)
      .set("Authorization", `Bearer ${accessToken}`);
    const transaction = (txRes.body as Array<Record<string, unknown>>)[0]!;

    const entertainmentCategoryId = await categoryIdBySlug(prisma, "spending.entertainment");
    await request(app.getHttpServer())
      .post("/transactions/category-corrections")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ transactionId: transaction.id, categoryId: entertainmentCategoryId });

    // Reprocess the exact same job — extraction/classification re-run from
    // scratch, but the correction must survive.
    await processStatementJob({ prisma, s3 }, jobId);

    const reprocessed = await prisma.transaction.findUniqueOrThrow({ where: { id: transaction.id as string } });
    assert.equal(reprocessed.subcategoryId, entertainmentCategoryId);
    assert.equal(reprocessed.classificationSource, "user_correction");
  } finally {
    await app.close();
  }
});

test("correcting another user's transaction is rejected as not found, not applied cross-tenant", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const userA = await registerVerifiedUser(app);
    const userB = await registerVerifiedUser(app);
    const pdf = await buildStatementPdf(HEADER, [
      row("FF11111111", "2026-08-01", "08:00:00", "Airtime Purchase", "Completed", "-100.00", "4900.00"),
    ]);
    const { statementId } = await uploadAndProcess(app, prisma, s3, userA.accessToken, pdf);
    const txRes = await request(app.getHttpServer())
      .get(`/statements/${statementId}/transactions`)
      .set("Authorization", `Bearer ${userA.accessToken}`);
    const transaction = (txRes.body as Array<Record<string, unknown>>)[0]!;

    const someCategoryId = await categoryIdBySlug(prisma, "spending.shopping");
    const crossRes = await request(app.getHttpServer())
      .post("/transactions/category-corrections")
      .set("Authorization", `Bearer ${userB.accessToken}`)
      .send({ transactionId: transaction.id, categoryId: someCategoryId });
    assert.equal(crossRes.status, 404);
  } finally {
    await app.close();
  }
});

test("GET /categories lists the full taxonomy, top-level categories alongside their subcategories", async () => {
  const { app } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const res = await request(app.getHttpServer()).get("/categories").set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.status, 200);
    const categories = res.body as Array<{ id: string; parentId: string | null; name: string; isActive: boolean }>;

    const spending = categories.find((c) => c.parentId === null && c.name === "Spending");
    assert.ok(spending);
    const foodAndDining = categories.find((c) => c.name === "Food & Dining");
    assert.ok(foodAndDining);
    assert.equal(foodAndDining!.parentId, spending!.id);
    assert.ok(categories.every((c) => c.isActive));
  } finally {
    await app.close();
  }
});

test("GET /transactions lists across every statement for the owner's most recent active month, scoped to that owner only", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const userA = await registerVerifiedUser(app);
    const userB = await registerVerifiedUser(app);

    const firstPdf = await buildStatementPdf(HEADER, [
      row("HH11111111", "2026-08-01", "08:00:00", "Airtime Purchase", "Completed", "-100.00", "4900.00"),
    ]);
    await uploadAndProcess(app, prisma, s3, userA.accessToken, firstPdf);
    const secondPdf = await buildStatementPdf(HEADER, [
      row("HH11111112", "2026-08-02", "09:00:00", "Customer Withdrawal at Agent 123456", "Completed", "-200.00", "4700.00"),
    ]);
    await uploadAndProcess(app, prisma, s3, userA.accessToken, secondPdf);
    // User B's own transaction must never leak into User A's list.
    const otherPdf = await buildStatementPdf(HEADER, [
      row("HH11111113", "2026-08-03", "10:00:00", "Airtime Purchase", "Completed", "-50.00", "950.00"),
    ]);
    await uploadAndProcess(app, prisma, s3, userB.accessToken, otherPdf);

    const res = await request(app.getHttpServer()).get("/transactions").set("Authorization", `Bearer ${userA.accessToken}`);
    assert.equal(res.status, 200);
    const transactions = res.body as Array<{ referenceNumber: string }>;
    assert.equal(transactions.length, 2); // both of User A's, across two statements
    assert.ok(transactions.every((t) => t.referenceNumber !== "HH11111113"));
  } finally {
    await app.close();
  }
});
