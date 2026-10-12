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

const FIXTURE_PASSWORD = "123456";

/** Same single-row fixture as buildValidPdfFixture, but encrypted — the
 * PDF the M-Pesa app emails is password-protected by default, so this is
 * the realistic case, not an edge case. */
async function buildEncryptedPdfFixture(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, userPassword: FIXTURE_PASSWORD, ownerPassword: "owner-test-only" });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(10).text("M-PESA STATEMENT (synthetic test fixture — not a real account)");
    doc.text("AA11111111 2026-01-05 10:00:00 Customer Transfer to JOHN DOE 254722000111 Completed 500.00 4500.00");
    doc.end();
  });
}

async function uploadFixture(
  app: INestApplication,
  accessToken: string,
  pdfBytes: Buffer,
): Promise<string> {
  const uploadUrlRes = await request(app.getHttpServer())
    .post("/statements/upload-url")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ filename: "statement.pdf", contentType: "application/pdf", sizeBytes: pdfBytes.length });
  const { statementId, uploadUrl } = uploadUrlRes.body;
  const putRes = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: pdfBytes });
  assert.equal(putRes.status, 200);
  return statementId as string;
}

// The e2e suite runs the processor directly rather than through a live
// BullMQ worker (see the file header), so the password is passed to
// processStatementJob here exactly the way worker.ts passes job.data.password.
// The confirm/reprocess endpoints accepting the body (200) is asserted too;
// the enqueue forwarding between them is a one-line pass-through.
test("a password-protected statement processes when the password is supplied at confirm", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const statementId = await uploadFixture(app, accessToken, await buildEncryptedPdfFixture());

    const confirmRes = await request(app.getHttpServer())
      .post(`/statements/${statementId}/confirm`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ password: FIXTURE_PASSWORD });
    assert.equal(confirmRes.status, 200);

    await processStatementJob({ prisma, s3 }, confirmRes.body.job.id, { password: FIXTURE_PASSWORD });

    const afterRes = await request(app.getHttpServer())
      .get(`/statements/${statementId}`)
      .set("Authorization", `Bearer ${accessToken}`);
    assert.equal(afterRes.body.statement.status, "processed");
    assert.equal(afterRes.body.statement.transactionCount, 1);
    assert.equal(afterRes.body.job.errorCode, null);
  } finally {
    await app.close();
  }
});

test("a password-protected statement without its password fails as password_required, a wrong one as password_incorrect, and reprocess with the right one succeeds without re-uploading", async () => {
  const { app, prisma, s3 } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const statementId = await uploadFixture(app, accessToken, await buildEncryptedPdfFixture());

    // No password at all.
    const confirmRes = await request(app.getHttpServer())
      .post(`/statements/${statementId}/confirm`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send();
    assert.equal(confirmRes.status, 200);
    await processStatementJob({ prisma, s3 }, confirmRes.body.job.id);
    let res = await request(app.getHttpServer()).get(`/statements/${statementId}`).set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.body.statement.status, "failed");
    assert.equal(res.body.job.errorCode, "password_required");

    // Wrong password, via reprocess — same uploaded file, new job.
    const wrongRes = await request(app.getHttpServer())
      .post(`/statements/${statementId}/reprocess`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ password: "not-the-password" });
    assert.equal(wrongRes.status, 200);
    assert.notEqual(wrongRes.body.job.id, confirmRes.body.job.id);
    await processStatementJob({ prisma, s3 }, wrongRes.body.job.id, { password: "not-the-password" });
    res = await request(app.getHttpServer()).get(`/statements/${statementId}`).set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.body.statement.status, "failed");
    assert.equal(res.body.job.errorCode, "password_incorrect");

    // Right password, via reprocess.
    const rightRes = await request(app.getHttpServer())
      .post(`/statements/${statementId}/reprocess`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ password: FIXTURE_PASSWORD });
    assert.equal(rightRes.status, 200);
    await processStatementJob({ prisma, s3 }, rightRes.body.job.id, { password: FIXTURE_PASSWORD });
    res = await request(app.getHttpServer()).get(`/statements/${statementId}`).set("Authorization", `Bearer ${accessToken}`);
    assert.equal(res.body.statement.status, "processed");
    assert.equal(res.body.statement.transactionCount, 1);
    assert.equal(res.body.job.errorCode, null);

    // The password must never have been persisted anywhere on the statement
    // or its jobs — the DB rows are the only durable record.
    const statementRow = await prisma.statement.findUniqueOrThrow({ where: { id: statementId }, include: { jobs: true } });
    const serialized = JSON.stringify(statementRow);
    assert.ok(!serialized.includes(FIXTURE_PASSWORD));
  } finally {
    await app.close();
  }
});

test("reprocess is refused for a statement that was never uploaded or is still in flight", async () => {
  const { app } = await createTestApp();
  try {
    const { accessToken } = await registerVerifiedUser(app);
    const pdfBytes = await buildValidPdfFixture();
    const uploadUrlRes = await request(app.getHttpServer())
      .post("/statements/upload-url")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ filename: "statement.pdf", contentType: "application/pdf", sizeBytes: pdfBytes.length });
    const { statementId } = uploadUrlRes.body;

    // pending_upload: nothing to reprocess yet.
    const res = await request(app.getHttpServer())
      .post(`/statements/${statementId}/reprocess`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ password: "irrelevant" });
    assert.equal(res.status, 400);
  } finally {
    await app.close();
  }
});

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
    // "processed" — extraction, categorization, and analytics (Stage 6/7/8)
    // all succeeded, so the pipeline is finally fully done, not stuck
    // mid-pipeline.
    assert.equal(afterRes.body.statement.status, "processed");
    assert.equal(afterRes.body.statement.pageCount, 1);
    assert.equal(afterRes.body.statement.transactionCount, 1);
    // "calculating_analytics" — Stage 8 added a real stage transition here
    // (docs/06: "no simulated progress"), so this is now genuinely the last
    // stage the job reaches until Stage 10's insights exist.
    assert.equal(afterRes.body.job.stage, "calculating_analytics");
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
