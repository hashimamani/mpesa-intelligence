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
 * Exercises Stage 8's analytics engine (analytics/summary.ts) through the
 * real pipeline — statement upload -> extraction -> categorization ->
 * SpendingSummary — against real Postgres/Redis/MinIO. See
 * docs/17-analytics-engine.md.
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
  const email = `analytics-${randomUUID()}@example.com`;
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
  await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: pdfBytes });
  const confirmRes = await request(app.getHttpServer())
    .post(`/statements/${statementId}/confirm`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send();
  await processStatementJob({ prisma, s3 }, confirmRes.body.job.id);
  return { statementId };
}

function header(period: string): string[] {
  return ["M-PESA STATEMENT", "Customer Name: JANE MUTHONI", `Statement Period: ${period}`];
}

test("summary totals: received, spent (Spending category only), fees, and net movement are all correct", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const rows = [
      row("AA11111111", "2026-08-01", "08:00:00", "Funds received from 254733111222 - MARY WANJIRU", "Completed", "5000.00", "5000.00"),
      row("AA11111112", "2026-08-02", "09:00:00", "Merchant Payment Online to 5509416 - NAIVAS SUPERMARKET", "Completed", "-1500.00", "3500.00"),
      row("AA11111113", "2026-08-03", "10:00:00", "Pay Bill Online Charge", "Completed", "-22.00", "3478.00"),
      // A P2P transfer out — moves the balance, but is NOT "spending".
      row("AA11111114", "2026-08-04", "11:00:00", "Customer Transfer to 254722000111 - JOHN KAMAU", "Completed", "-1000.00", "2478.00"),
    ];
    const pdf = await buildStatementPdf(header("01 Aug 2026 - 31 Aug 2026"), rows);
    await uploadAndProcess(app, prisma, s3, accessToken, pdf);

    const res = await request(app.getHttpServer())
      .get("/analytics/summary?month=2026-08")
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.status, 200);
    const summary = res.body;

    assert.equal(summary.periodStart, "2026-08-01");
    assert.equal(summary.periodEnd, "2026-08-31");
    assert.deepEqual(summary.totalReceived, { amount: "5000.00", currency: "KES" });
    // Spending only: NAIVAS (1500) + the Pay Bill Charge fee (22) = 1522 —
    // the 1000 P2P transfer must NOT be counted as spending.
    assert.deepEqual(summary.totalSpent, { amount: "1522.00", currency: "KES" });
    assert.deepEqual(summary.totalFees, { amount: "22.00", currency: "KES" });
    // Net movement counts EVERY debit regardless of category: 5000 - 1500 - 22 - 1000 = 2478.
    assert.deepEqual(summary.netMovement, { amount: "2478.00", currency: "KES" });
  } finally {
    await app.close();
  }
});

test("byCategory: broken down by Spending subcategory, sorted biggest first, and excludes Transfers entirely", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const rows = [
      row("BB11111111", "2026-08-01", "08:00:00", "Merchant Payment Online to 5509416 - NAIVAS SUPERMARKET", "Completed", "-1500.00", "8500.00"),
      row("BB11111112", "2026-08-02", "09:00:00", "Airtime Purchase", "Completed", "-100.00", "8400.00"),
      row("BB11111113", "2026-08-03", "10:00:00", "Airtime Purchase", "Completed", "-50.00", "8350.00"),
      row("BB11111114", "2026-08-04", "11:00:00", "Customer Transfer to 254722000111 - JOHN KAMAU", "Completed", "-2000.00", "6350.00"),
    ];
    const pdf = await buildStatementPdf(header("01 Aug 2026 - 31 Aug 2026"), rows);
    await uploadAndProcess(app, prisma, s3, accessToken, pdf);

    const res = await request(app.getHttpServer())
      .get("/analytics/summary?month=2026-08")
      .set("Authorization", `Bearer ${accessToken}`);
    const byCategory = res.body.byCategory as Array<{ categoryId: string; categoryName: string; total: { amount: string } }>;

    // NAIVAS (1500) is Food & Dining; the two airtime purchases (100 + 50 =
    // 150) combine into one Airtime & Data bucket. Sorted biggest first.
    assert.equal(byCategory.length, 2);
    assert.equal(byCategory[0]!.categoryName, "Food & Dining");
    assert.equal(byCategory[0]!.total.amount, "1500.00");
    assert.equal(byCategory[1]!.categoryName, "Airtime & Data");
    assert.equal(byCategory[1]!.total.amount, "150.00");
    // No Transfers entry anywhere — a P2P transfer isn't spend-by-category.
    assert.ok(!byCategory.some((c) => c.categoryName.includes("Transfer")));
  } finally {
    await app.close();
  }
});

test("topMerchants: real merchants only, a P2P transfer counterparty never appears", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const rows = [
      row("CC11111111", "2026-08-01", "08:00:00", "Merchant Payment Online to 5509416 - NAIVAS SUPERMARKET", "Completed", "-1500.00", "8500.00"),
      row("CC11111112", "2026-08-02", "09:00:00", "Merchant Payment Online to 5509416 - NAIVAS SUPERMARKET", "Completed", "-800.00", "7700.00"),
      row("CC11111113", "2026-08-03", "10:00:00", "Customer Transfer to 254722000111 - JOHN KAMAU", "Completed", "-2000.00", "5700.00"),
    ];
    const pdf = await buildStatementPdf(header("01 Aug 2026 - 31 Aug 2026"), rows);
    await uploadAndProcess(app, prisma, s3, accessToken, pdf);

    const res = await request(app.getHttpServer())
      .get("/analytics/summary?month=2026-08")
      .set("Authorization", `Bearer ${accessToken}`);
    const topMerchants = res.body.topMerchants as Array<{ merchantName: string; total: { amount: string }; transactionCount: number }>;

    assert.equal(topMerchants.length, 1);
    assert.equal(topMerchants[0]!.merchantName, "NAIVAS SUPERMARKET");
    assert.equal(topMerchants[0]!.total.amount, "2300.00");
    assert.equal(topMerchants[0]!.transactionCount, 2);
    assert.ok(!topMerchants.some((m) => m.merchantName === "JOHN KAMAU"));
  } finally {
    await app.close();
  }
});

test("summary with no month given defaults to the most recent month with any activity, not the real current month", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const pdf = await buildStatementPdf(header("01 Feb 2020 - 28 Feb 2020"), [
      row("DD11111111", "2020-02-15", "08:00:00", "Airtime Purchase", "Completed", "-100.00", "900.00"),
    ]);
    await uploadAndProcess(app, prisma, s3, accessToken, pdf);

    const res = await request(app.getHttpServer()).get("/analytics/summary").set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.body.periodStart, "2020-02-01");
    assert.equal(res.body.totalSpent.amount, "100.00");
  } finally {
    await app.close();
  }
});

test("an owner with zero transactions gets a correctly empty (all-zero) summary, not an error", async () => {
  const { app } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const res = await request(app.getHttpServer()).get("/analytics/summary").set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.totalReceived, { amount: "0.00", currency: "KES" });
    assert.deepEqual(res.body.totalSpent, { amount: "0.00", currency: "KES" });
    assert.deepEqual(res.body.byCategory, []);
    assert.deepEqual(res.body.topMerchants, []);
  } finally {
    await app.close();
  }
});

test("rejects a malformed month query param rather than silently misinterpreting it", async () => {
  const { app } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const res = await request(app.getHttpServer()).get("/analytics/summary?month=not-a-month").set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});

test("trend: returns one entry per month, oldest first, including zero-activity months, ending at the most recent active month", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    // June has activity; July is a gap; August has activity again.
    const junePdf = await buildStatementPdf(header("01 Jun 2026 - 30 Jun 2026"), [
      row("EE11111111", "2026-06-05", "08:00:00", "Airtime Purchase", "Completed", "-50.00", "950.00"),
    ]);
    await uploadAndProcess(app, prisma, s3, accessToken, junePdf);
    const augustPdf = await buildStatementPdf(header("01 Aug 2026 - 31 Aug 2026"), [
      row("EE11111112", "2026-08-05", "08:00:00", "Airtime Purchase", "Completed", "-75.00", "925.00"),
    ]);
    await uploadAndProcess(app, prisma, s3, accessToken, augustPdf);

    const res = await request(app.getHttpServer()).get("/analytics/trend?months=3").set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.status, 200);
    const trend = res.body as Array<{ periodStart: string; totalSpent: { amount: string } }>;
    assert.equal(trend.length, 3);
    assert.deepEqual(
      trend.map((t) => t.periodStart),
      ["2026-06-01", "2026-07-01", "2026-08-01"],
    );
    assert.equal(trend[0]!.totalSpent.amount, "50.00");
    assert.equal(trend[1]!.totalSpent.amount, "0.00"); // July: the gap month
    assert.equal(trend[2]!.totalSpent.amount, "75.00");
  } finally {
    await app.close();
  }
});

test("a category correction updates that month's summary immediately, without waiting for another statement upload", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const pdf = await buildStatementPdf(header("01 Aug 2026 - 31 Aug 2026"), [
      row("FF11111111", "2026-08-01", "08:00:00", "Merchant Payment Online to 5509416 - NAIVAS SUPERMARKET", "Completed", "-1500.00", "3500.00"),
    ]);
    const { statementId } = await uploadAndProcess(app, prisma, s3, accessToken, pdf);

    const before = await request(app.getHttpServer()).get("/analytics/summary?month=2026-08").set("Authorization", `Bearer ${accessToken}`);
    assert.equal(before.body.byCategory.find((c: { categoryName: string }) => c.categoryName === "Food & Dining")?.total.amount, "1500.00");

    const txRes = await request(app.getHttpServer())
      .get(`/statements/${statementId}/transactions`)
      .set("Authorization", `Bearer ${accessToken}`);
    const transaction = (txRes.body as Array<Record<string, unknown>>)[0]!;
    const shoppingCategory = await prisma.category.findUniqueOrThrow({ where: { slug: "spending.shopping" } });

    await request(app.getHttpServer())
      .post("/transactions/category-corrections")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ transactionId: transaction.id, categoryId: shoppingCategory.id });

    const after = await request(app.getHttpServer()).get("/analytics/summary?month=2026-08").set("Authorization", `Bearer ${accessToken}`);
    const afterCategories = after.body.byCategory as Array<{ categoryName: string; total: { amount: string } }>;
    assert.equal(afterCategories.find((c) => c.categoryName === "Food & Dining"), undefined);
    assert.equal(afterCategories.find((c) => c.categoryName === "Shopping")?.total.amount, "1500.00");
  } finally {
    await app.close();
  }
});

test("statement reaches 'processed' status (not stuck at 'processing') once analytics has run, and records analyticsVersion", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const pdf = await buildStatementPdf(header("01 Aug 2026 - 31 Aug 2026"), [
      row("GG11111111", "2026-08-01", "08:00:00", "Airtime Purchase", "Completed", "-100.00", "4900.00"),
    ]);
    const { statementId } = await uploadAndProcess(app, prisma, s3, accessToken, pdf);

    const stored = await prisma.statement.findUniqueOrThrow({ where: { id: statementId } });
    assert.equal(stored.status, "processed");
    assert.equal(stored.analyticsVersion, "mpesa-analytics-v1");
  } finally {
    await app.close();
  }
});
