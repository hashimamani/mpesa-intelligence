import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { EmailService, type SendEmailInput } from "../src/email/email.service";

/**
 * Runs the real HTTP pipeline (Nest app, guards, validation pipes) against
 * the real local Postgres from docker-compose — per the project's testing
 * principle (docs/09-testing-deployment-strategy.md), integration tests hit
 * a real database, not a mock. The only thing substituted is EmailService,
 * and only to capture what would have been sent instead of scraping process
 * logs — production code is untouched; the real ConsoleEmailService is what
 * actually runs outside this test.
 */
class CapturingEmailService extends EmailService {
  sent: SendEmailInput[] = [];
  async send(input: SendEmailInput): Promise<void> {
    this.sent.push(input);
  }
}

async function createTestApp(): Promise<{ app: INestApplication; email: CapturingEmailService }> {
  const email = new CapturingEmailService();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EmailService)
    .useValue(email)
    .compile();

  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  await app.init();
  return { app, email };
}

function extractToken(body: string, path: string): string {
  const match = new RegExp(`${path}\\?token=([a-f0-9]+)`).exec(body);
  if (!match) throw new Error(`No token found for "${path}" in email body: ${body}`);
  return match[1] as string;
}

test("full auth flow: register -> verify -> login -> me -> refresh rotation -> reuse detection -> logout", async () => {
  const { app, email } = await createTestApp();
  const server = app.getHttpServer();
  const userEmail = `test-${randomUUID()}@example.com`;
  const password = "Sup3rSecret99";

  try {
    const registerRes = await request(server).post("/auth/register").send({ email: userEmail, password });
    assert.equal(registerRes.status, 201);
    assert.equal(registerRes.body.user.emailVerified, false);
    assert.equal(email.sent.length, 1);
    assert.equal(email.sent[0]?.to, userEmail);

    const verifyToken = extractToken(email.sent[0]?.body ?? "", "/verify-email");
    const verifyRes = await request(server).post("/auth/verify-email").send({ token: verifyToken });
    assert.equal(verifyRes.status, 200);

    // Reusing an already-consumed verification token must fail.
    const verifyAgainRes = await request(server).post("/auth/verify-email").send({ token: verifyToken });
    assert.equal(verifyAgainRes.status, 401);

    const loginRes = await request(server).post("/auth/login").send({ email: userEmail, password });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.body.user.emailVerified, true);
    assert.ok(typeof loginRes.body.accessToken === "string" && loginRes.body.accessToken.length > 0);
    const loginCookies = loginRes.headers["set-cookie"] as unknown as string[];
    assert.ok(loginCookies?.[0]?.includes("HttpOnly"));
    assert.ok(loginCookies?.[0]?.includes("SameSite=Lax"));

    const wrongPasswordRes = await request(server).post("/auth/login").send({ email: userEmail, password: "WrongPassword1" });
    assert.equal(wrongPasswordRes.status, 401);

    const accessToken = loginRes.body.accessToken as string;
    const meRes = await request(server).get("/auth/me").set("Authorization", `Bearer ${accessToken}`);
    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.email, userEmail);

    const meNoAuthRes = await request(server).get("/auth/me");
    assert.equal(meNoAuthRes.status, 401);

    const refreshRes = await request(server).post("/auth/refresh").set("Cookie", loginCookies).send({});
    assert.equal(refreshRes.status, 200);
    assert.ok(typeof refreshRes.body.accessToken === "string" && refreshRes.body.accessToken.length > 0);
    const rotatedCookies = refreshRes.headers["set-cookie"] as unknown as string[];
    assert.notEqual(rotatedCookies[0], loginCookies[0]);

    // Reusing the OLD (already-rotated) refresh cookie must fail...
    const reuseRes = await request(server).post("/auth/refresh").set("Cookie", loginCookies).send({});
    assert.equal(reuseRes.status, 401);

    // ...and must have revoked the session it was rotated into as well (theft response).
    const rotatedNowDeadRes = await request(server).post("/auth/refresh").set("Cookie", rotatedCookies).send({});
    assert.equal(rotatedNowDeadRes.status, 401);

    // Log back in to get a fresh, valid session to exercise logout.
    const secondLoginRes = await request(server).post("/auth/login").send({ email: userEmail, password });
    const secondCookies = secondLoginRes.headers["set-cookie"] as unknown as string[];

    const logoutRes = await request(server).post("/auth/logout").set("Cookie", secondCookies).send({});
    assert.equal(logoutRes.status, 204);

    const refreshAfterLogoutRes = await request(server).post("/auth/refresh").set("Cookie", secondCookies).send({});
    assert.equal(refreshAfterLogoutRes.status, 401);
  } finally {
    await app.close();
  }
});

test("rejects a weak password and a malformed email on register", async () => {
  const { app } = await createTestApp();
  try {
    const weakRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: `weak-${randomUUID()}@example.com`, password: "short" });
    assert.equal(weakRes.status, 400);

    const badEmailRes = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: "not-an-email", password: "Sup3rSecret99" });
    assert.equal(badEmailRes.status, 400);
  } finally {
    await app.close();
  }
});

test("rejects registering the same email twice", async () => {
  const { app } = await createTestApp();
  const userEmail = `dup-${randomUUID()}@example.com`;
  try {
    const first = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: userEmail, password: "Sup3rSecret99" });
    assert.equal(first.status, 201);

    const second = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email: userEmail, password: "Sup3rSecret99" });
    assert.equal(second.status, 409);
  } finally {
    await app.close();
  }
});

test("forgot-password responds identically for existing and nonexistent accounts", async () => {
  const { app, email } = await createTestApp();
  const userEmail = `forgot-${randomUUID()}@example.com`;
  try {
    await request(app.getHttpServer()).post("/auth/register").send({ email: userEmail, password: "Sup3rSecret99" });
    email.sent = [];

    const existingRes = await request(app.getHttpServer()).post("/auth/forgot-password").send({ email: userEmail });
    const nonexistentRes = await request(app.getHttpServer())
      .post("/auth/forgot-password")
      .send({ email: `nobody-${randomUUID()}@example.com` });

    assert.equal(existingRes.status, nonexistentRes.status);
    assert.deepEqual(existingRes.body, nonexistentRes.body);
    // Only the real account actually gets an email queued.
    assert.equal(email.sent.length, 1);

    const resetToken = extractToken(email.sent[0]?.body ?? "", "/reset-password");
    const resetRes = await request(app.getHttpServer())
      .post("/auth/reset-password")
      .send({ token: resetToken, newPassword: "BrandNewSecret1" });
    assert.equal(resetRes.status, 200);

    const oldPasswordLoginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: userEmail, password: "Sup3rSecret99" });
    assert.equal(oldPasswordLoginRes.status, 401);

    const newPasswordLoginRes = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: userEmail, password: "BrandNewSecret1" });
    assert.equal(newPasswordLoginRes.status, 200);
  } finally {
    await app.close();
  }
});
