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
 * (docs/09 §Statement fixture testing) — but its row *shape* (signed
 * amounts, receipt numbers shared across a payment and its own charge line)
 * was calibrated against a real statement. See docs/15-extraction-engine.md.
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

/** Amounts are signed here — negative for withdrawn, positive for paid in —
 * matching the real statement format this pipeline is calibrated against. */
function row(ref: string, date: string, time: string, description: string, status: string, amount: string, balance: string): string {
  return `${ref} ${date} ${time} ${description} ${status} ${amount} ${balance}`;
}

async function buildStatementPdf(headerLines: string[], rows: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Landscape + reduced margins avoid pdfkit's flowing-text wrapping a
    // long row onto two baselines (found by actually running rows through
    // the real parser, not assumed) — a real M-Pesa PDF doesn't have this
    // problem at all, since its Details/Status/Amount/Balance cells are
    // genuinely fixed-position table columns rather than one flowing text
    // block, but a synthetic fixture built from plain doc.text() calls does
    // not replicate that, so this compensates instead.
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

/**
 * Unlike `buildStatementPdf` above (one flowing text line per row — fine for
 * exercising the legacy fixed-regex fallback, but not a genuine positioned
 * table), this places each header label and each row's cells at explicit
 * (x, y) coordinates — a real column layout, the way an actual M-Pesa PDF's
 * table is built. Used to prove the header-driven dynamic parser
 * (extraction/column-mapper.ts) through the real pdfjs extraction path, not
 * just against hand-built PositionedItem fixtures in its own unit tests.
 */
async function buildColumnarStatementPdf(
  preambleLines: string[],
  columns: { label: string; x: number }[],
  dataRows: string[][],
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, layout: "landscape", size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(10);

    let y = 40;
    for (const line of preambleLines) {
      doc.text(line, 40, y, { lineBreak: false });
      y += 16;
    }
    y += 10;
    for (const column of columns) doc.text(column.label, column.x, y, { lineBreak: false });
    y += 16;
    for (const cells of dataRows) {
      columns.forEach((column, i) => {
        const value = cells[i];
        if (value) doc.text(value, column.x, y, { lineBreak: false });
      });
      y += 16;
    }
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

const HEADER = ["M-PESA STATEMENT", "Customer Name: JANE MUTHONI", "Statement Period: 01 Aug 2026 - 31 Aug 2026"];

test("extracts a clean statement into correctly typed, directed, and reconciled transactions", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken, userId } = await registerVerifiedUser(app);
    const rows = [
      row("AA11111111", "2026-08-01", "08:00:00", "Funds received from 254733111222 - MARY WANJIRU", "Completed", "5000.00", "5000.00"),
      // 5000 - 1000 - 22 = 3978 — the group's net effect (both rows show
      // that same final balance rather than an incremental per-row delta,
      // matching real observed behavior).
      row("AA11111112", "2026-08-02", "09:15:00", "Pay Bill Online to 522533 - KPLC PREPAID Acc. 987654321", "Completed", "-1000.00", "3978.00"),
      row("AA11111112", "2026-08-02", "09:15:00", "Pay Bill Charge", "Completed", "-22.00", "3978.00"), // shares AA11111112's receipt number — real behavior
      row("AA11111114", "2026-08-03", "14:03:10", "Customer Transfer to 254722000111 - JOHN KAMAU", "Completed", "-500.00", "3478.00"),
      row("AA11111115", "2026-08-04", "12:45:00", "Merchant Payment Online to 5509416 - NAIVAS SUPERMARKET", "Completed", "-1250.00", "2228.00"),
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

    // Two rows share receipt AA11111112 (the payment and its charge) —
    // both must persist as distinct transactions, not collide.
    const groupRows = transactions.filter((t) => t.referenceNumber === "AA11111112");
    assert.equal(groupRows.length, 2);
    const payBill = groupRows.find((t) => t.transactionType === "pay_bill")!;
    const charge = groupRows.find((t) => t.transactionType === "fee")!;
    assert.equal(payBill.direction, "debit");
    assert.deepEqual(payBill.amount, { amount: "1000.00", currency: "KES" });
    assert.deepEqual(charge.amount, { amount: "22.00", currency: "KES" });

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
      row("BB11111111", "2026-08-01", "08:00:00", "Funds received from 254733111222 - MARY WANJIRU", "Completed", "5000.00", "5000.00"),
      // Balance only moved by 400 but the row claims 500 — inconsistent.
      row("BB11111112", "2026-08-02", "09:15:00", "Customer Transfer to 254722000111 - JOHN KAMAU", "Completed", "-500.00", "4600.00"),
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
    const sharedRow = row("CC11111111", "2026-08-01", "08:00:00", "Funds received from 254733111222 - MARY WANJIRU", "Completed", "5000.00", "5000.00");

    const pdf1 = await buildStatementPdf(HEADER, [sharedRow]);
    const { statementId: firstId } = await uploadAndProcess(app, prisma, s3, accessToken, pdf1, "first.pdf");

    const pdf2 = await buildStatementPdf(HEADER, [
      sharedRow,
      row("CC11111112", "2026-08-02", "09:00:00", "Customer Transfer to 254722000111 - JOHN KAMAU", "Completed", "-500.00", "4500.00"),
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

test("a payment and its own charge (sharing one receipt number) are NOT flagged as duplicates of each other", async () => {
  // Regression test for a real bug: referenceNumber alone isn't a safe
  // duplicate key, since a real statement's charge/overdraft lines share
  // their parent transaction's receipt number. Re-uploading the SAME
  // statement should flag both sibling rows as duplicates of their true
  // counterparts — never cross-flag the payment as a duplicate of its own charge.
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const rows = [
      row("DD11111111", "2026-08-01", "08:00:00", "Pay Bill Online to 522533 - KPLC PREPAID", "Completed", "-1000.00", "4000.00"),
      row("DD11111111", "2026-08-01", "08:00:00", "Pay Bill Charge", "Completed", "-22.00", "4000.00"),
    ];
    const pdf1 = await buildStatementPdf(HEADER, rows);
    const { statementId: firstId } = await uploadAndProcess(app, prisma, s3, accessToken, pdf1, "first.pdf");
    const pdf2 = await buildStatementPdf(HEADER, rows);
    const { statementId: secondId } = await uploadAndProcess(app, prisma, s3, accessToken, pdf2, "second.pdf");

    const secondTx = (
      await request(app.getHttpServer())
        .get(`/statements/${secondId}/transactions`)
        .set("Authorization", `Bearer ${accessToken}`)
    ).body as Array<Record<string, unknown>>;
    assert.equal(secondTx.length, 2);
    assert.ok(secondTx.every((t) => t.isDuplicate === true));

    const firstTx = (
      await request(app.getHttpServer())
        .get(`/statements/${firstId}/transactions`)
        .set("Authorization", `Bearer ${accessToken}`)
    ).body as Array<Record<string, unknown>>;
    assert.ok(firstTx.every((t) => t.isDuplicate === false));

    const dbCount = await prisma.transaction.count({ where: { statementId: firstId } });
    assert.equal(dbCount, 2); // the payment and its charge are two distinct rows, not merged/collided
  } finally {
    await app.close();
  }
});

test("reprocessing the same job is idempotent — no duplicate transactions on retry", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const rows = [
      row("EE11111111", "2026-08-01", "08:00:00", "Funds received from 254733111222 - MARY WANJIRU", "Completed", "5000.00", "5000.00"),
      row("EE11111112", "2026-08-02", "09:00:00", "Customer Transfer to 254722000111 - JOHN KAMAU", "Completed", "-500.00", "4500.00"),
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
      row("FF11111111", "2026-08-01", "08:00:00", "Funds received from 254733111222 - MARY WANJIRU", "Completed", "5000.00", "5000.00"),
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

test("extracts a statement whose columns are reordered and relabeled — proves the header-driven dynamic parser generalizes, not just the one layout it was calibrated against", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);

    // Deliberately the opposite of the real statement's own order (which is
    // Receipt, Time, Details, Status, Paid In, Withdrawn, Balance), and using
    // different-but-recognizable header wording ("Money In"/"Money Out"
    // instead of "Paid In"/"Withdrawn", "Narrative" instead of "Details",
    // "Date/Time" instead of "Completion Time").
    const columns = [
      { label: "Balance", x: 40 },
      { label: "Money Out", x: 110 },
      { label: "Money In", x: 180 },
      { label: "Status", x: 250 },
      { label: "Narrative", x: 330 },
      { label: "Date/Time", x: 490 },
      { label: "Receipt", x: 650 },
    ];
    const dataRows = [
      ["5000.00", "", "5000.00", "Completed", "Funds received", "2026-08-01 08:00:00", "GG11111111"],
      ["4000.00", "1000.00", "", "Completed", "Airtime Purchase", "2026-08-02 09:15:00", "GG11111112"],
    ];
    const pdf = await buildColumnarStatementPdf(HEADER, columns, dataRows);

    const { statementId } = await uploadAndProcess(app, prisma, s3, accessToken, pdf);

    const statementRes = await request(app.getHttpServer())
      .get(`/statements/${statementId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(statementRes.body.statement.status, "processing"); // not needs_review, not failed
    assert.equal(statementRes.body.statement.transactionCount, 2);

    const txRes = await request(app.getHttpServer())
      .get(`/statements/${statementId}/transactions`)
      .set("Authorization", `Bearer ${accessToken}`);
    const transactions = txRes.body as Array<Record<string, unknown>>;

    const credit = transactions.find((t) => t.referenceNumber === "GG11111111")!;
    assert.equal(credit.direction, "credit");
    assert.deepEqual(credit.amount, { amount: "5000.00", currency: "KES" });

    const debit = transactions.find((t) => t.referenceNumber === "GG11111112")!;
    assert.equal(debit.direction, "debit");
    assert.equal(debit.transactionType, "airtime");
    assert.deepEqual(debit.amount, { amount: "1000.00", currency: "KES" });
  } finally {
    await app.close();
  }
});
