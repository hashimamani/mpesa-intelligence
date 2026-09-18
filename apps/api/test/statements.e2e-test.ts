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
 * Real Postgres, real MinIO (S3-compatible), real Redis-backed queue
 * infrastructure — the only substitution is EmailService (see auth.e2e-test.ts
 * for why that one specifically is fine to swap). The processor is invoked
 * directly rather than waiting on a live BullMQ worker, so the test is
 * deterministic while still exercising the real processing logic — see
 * docs/13-auth-architecture.md's sibling note in statement-processor.ts.
 */
class CapturingEmailService extends EmailService {
  sent: SendEmailInput[] = [];
  async send(input: SendEmailInput): Promise<void> {
    this.sent.push(input);
  }
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

async function registerVerifiedUser(app: INestApplication): Promise<{ accessToken: string }> {
  const email = `stmt-${randomUUID()}@example.com`;
  const password = "Sup3rSecret99";
  const emailService = app.get(EmailService) as CapturingEmailService;

  await request(app.getHttpServer()).post("/auth/register").send({ email, password });
  const verifyToken = /\/verify-email\?token=([a-f0-9]+)/.exec(emailService.sent.at(-1)?.body ?? "")?.[1];
  assert.ok(verifyToken, "expected a verification token to have been captured");
  await request(app.getHttpServer()).post("/auth/verify-email").send({ token: verifyToken });

  const loginRes = await request(app.getHttpServer()).post("/auth/login").send({ email, password });
  assert.equal(loginRes.status, 200);
  return { accessToken: loginRes.body.accessToken as string };
}

/**
 * A real, valid, synthetic PDF — never a real person's statement (docs/09
 * §Statement fixture testing). Includes one row in the shape Stage 6's
 * parser actually expects (see docs/15-extraction-engine.md) so this test
 * exercises a genuine full-pipeline success, not just "the file opens."
 * Deeper extraction coverage (multiple rows, reconciliation, duplicates,
 * classification) lives in extraction.e2e-test.ts — this file stays focused
 * on the upload mechanics themselves.
 */
async function buildValidPdfFixture(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Narrower default margins avoid pdfkit line-wrapping a long row onto two
    // baselines, which would otherwise break row reconstruction (found by
    // actually running this against the real parser, not assumed) — matches
    // extraction.e2e-test.ts's fixture builder.
    const doc = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(10).text("M-PESA STATEMENT (synthetic test fixture — not a real account)");
    doc.text("AA11111111 2026-01-05 10:00:00 Customer Transfer to JOHN DOE 254722000111 Completed 500.00 4500.00");
    doc.end();
  });
}

test("full statement upload flow: request URL -> upload to S3 -> confirm -> process -> readable PDF", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const pdfBytes = await buildValidPdfFixture();

    const uploadUrlRes = await request(app.getHttpServer())
      .post("/statements/upload-url")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ filename: "statement.pdf", contentType: "application/pdf", sizeBytes: pdfBytes.length });
    assert.equal(uploadUrlRes.status, 201);
    const { statementId, uploadUrl } = uploadUrlRes.body;
    assert.ok(statementId);
    assert.ok(uploadUrl.startsWith("http"));

    // The client PUTs directly to storage — no API server involved, same as
    // the real web app will do (docs/13 pattern, applied here to files).
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: pdfBytes,
    });
    assert.equal(putRes.status, 200);

    const confirmRes = await request(app.getHttpServer())
      .post(`/statements/${statementId}/confirm`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send();
    assert.equal(confirmRes.status, 200);
    assert.equal(confirmRes.body.statement.status, "uploaded");
    assert.equal(confirmRes.body.job.stage, "uploaded");

    // Confirming twice must not silently re-process or duplicate the job.
    const confirmAgainRes = await request(app.getHttpServer())
      .post(`/statements/${statementId}/confirm`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send();
    assert.equal(confirmAgainRes.status, 400);

    // Run the real processor directly (see file header) instead of waiting on a live worker.
    await processStatementJob({ prisma, s3 }, confirmRes.body.job.id);

    const afterRes = await request(app.getHttpServer())
      .get(`/statements/${statementId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(afterRes.status, 200);
    // "processing", not "processed" — extraction and categorization (Stage
    // 6/7) succeeded, but analytics (Stage 8) hasn't run yet, so the
    // pipeline isn't fully done.
    assert.equal(afterRes.body.statement.status, "processing");
    assert.equal(afterRes.body.statement.pageCount, 1);
    assert.equal(afterRes.body.statement.transactionCount, 1);
    // "categorizing", not "reading_transactions" — Stage 7 added a real
    // stage transition here (docs/06: "no simulated progress"), so this is
    // now genuinely the last stage the job reaches until Stage 8 exists.
    assert.equal(afterRes.body.job.stage, "categorizing");
    assert.ok(afterRes.body.job.completedAt);
    assert.equal(afterRes.body.job.errorCode, null);

    const listRes = await request(app.getHttpServer())
      .get("/statements")
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.length, 1);
    assert.equal(listRes.body[0].id, statementId);
  } finally {
    await app.close();
  }
});

test("processor marks a corrupted/non-PDF upload as failed, not silently accepted", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const garbage = Buffer.from("this is not a pdf, just some bytes pretending to be one");

    const uploadUrlRes = await request(app.getHttpServer())
      .post("/statements/upload-url")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ filename: "not-a-statement.pdf", contentType: "application/pdf", sizeBytes: garbage.length });
    const { statementId, uploadUrl } = uploadUrlRes.body;

    await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: garbage });

    const confirmRes = await request(app.getHttpServer())
      .post(`/statements/${statementId}/confirm`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send();
    assert.equal(confirmRes.status, 200);

    await processStatementJob({ prisma, s3 }, confirmRes.body.job.id);

    const afterRes = await request(app.getHttpServer())
      .get(`/statements/${statementId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(afterRes.body.statement.status, "failed");
    assert.equal(afterRes.body.job.errorCode, "not_a_valid_pdf");
  } finally {
    await app.close();
  }
});

test("confirming without actually uploading the file fails, not silently succeeds", async () => {
  const { app } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);

    const uploadUrlRes = await request(app.getHttpServer())
      .post("/statements/upload-url")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ filename: "never-uploaded.pdf", contentType: "application/pdf", sizeBytes: 1234 });
    const { statementId } = uploadUrlRes.body;

    const confirmRes = await request(app.getHttpServer())
      .post(`/statements/${statementId}/confirm`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send();
    assert.equal(confirmRes.status, 400);
  } finally {
    await app.close();
  }
});

test("a statement belonging to another user is not visible (tenant isolation)", async () => {
  const { app } = await createTestApp();
  try {
    const userA = await registerVerifiedUser(app);
    const userB = await registerVerifiedUser(app);

    const uploadUrlRes = await request(app.getHttpServer())
      .post("/statements/upload-url")
      .set("Authorization", `Bearer ${userA.accessToken}`)
      .send({ filename: "a-private-statement.pdf", contentType: "application/pdf", sizeBytes: 100 });
    const { statementId } = uploadUrlRes.body;

    const crossAccessRes = await request(app.getHttpServer())
      .get(`/statements/${statementId}`)
      .set("Authorization", `Bearer ${userB.accessToken}`);
    assert.equal(crossAccessRes.status, 404);

    const crossListRes = await request(app.getHttpServer())
      .get("/statements")
      .set("Authorization", `Bearer ${userB.accessToken}`);
    assert.equal(crossListRes.body.length, 0);

    const noAuthRes = await request(app.getHttpServer()).get(`/statements/${statementId}`);
    assert.equal(noAuthRes.status, 401);
  } finally {
    await app.close();
  }
});

test("rejects an oversized or wrong-content-type upload request", async () => {
  const { app } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);

    const tooLargeRes = await request(app.getHttpServer())
      .post("/statements/upload-url")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ filename: "huge.pdf", contentType: "application/pdf", sizeBytes: 26 * 1024 * 1024 });
    assert.equal(tooLargeRes.status, 400);

    const wrongTypeRes = await request(app.getHttpServer())
      .post("/statements/upload-url")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ filename: "statement.csv", contentType: "text/csv", sizeBytes: 100 });
    assert.equal(wrongTypeRes.status, 400);
  } finally {
    await app.close();
  }
});
