"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { StatementDTO, StatementWithJobDTO, TransactionDTO } from "@mpesa/types";
import { AppShell, Alert, Badge, Button, Card, EmptyState, Input, ProcessingSteps, Spinner, Table, tableStyles } from "@mpesa/ui";
import { useAuth } from "../../lib/auth-context";
import { ApiError, statementsApi } from "../../lib/api";
import { AppNav } from "../../lib/nav";

const POLL_INTERVAL_MS = 1500;

/**
 * The worker records a precise reason for every failure
 * (statement-processor.ts's error codes); showing the user a generic
 * "try again" for all of them was actively wrong advice for the most
 * common real one — a scanned/photographed statement, where re-uploading
 * the same file can never help (see docs/15-extraction-engine.md). Each
 * known code gets a message that says what's wrong and what to do instead.
 */
function failureMessageFor(errorCode: string | null | undefined): { title: string; description: string } {
  switch (errorCode) {
    case "looks_like_scanned_document":
    case "no_extractable_text_layer":
      return {
        title: "This looks like a scanned or photographed statement",
        description:
          "We can only read the PDF the M-Pesa app or portal generates itself (Download statement), which has real text inside it — a scan or photo of a printed statement doesn't. Re-uploading this same file won't help; please export a fresh PDF from M-Pesa and upload that instead.",
      };
    case "password_required":
      return {
        title: "This statement is password-protected",
        description:
          "M-Pesa sends the password separately by SMS when it emails you the statement. Enter it below and we'll read the file you already uploaded — no need to upload it again.",
      };
    case "password_incorrect":
      return {
        title: "That password didn't unlock the statement",
        description: "Check the SMS M-Pesa sent with this statement and enter the password again below.",
      };
    case "no_transactions_found":
      return {
        title: "We couldn't find a transaction table in this PDF",
        description:
          "The file opened and has text in it, but nothing in it looks like an M-Pesa transaction list. Check that it's a full M-Pesa statement rather than a summary, receipt, or a different document.",
      };
    case "not_a_valid_pdf":
    case "pdf_has_no_pages":
      return {
        title: "This file isn't a readable PDF",
        description: "It may be corrupted, empty, or not actually a PDF. Please export the statement again from M-Pesa and upload the new file.",
      };
    default:
      return {
        title: "We couldn't finish analyzing this statement",
        description: "Something unexpected went wrong on our side. Try uploading it again, or contact support if it keeps happening.",
      };
  }
}

export default function UploadPage() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();

  const [statements, setStatements] = useState<StatementDTO[] | null>(null);
  const [active, setActive] = useState<StatementWithJobDTO | null>(null);
  const [activeTransactions, setActiveTransactions] = useState<TransactionDTO[] | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Statement PDF password. Held in component state only for as long as
  // it takes to send it — cleared the moment confirm/reprocess returns.
  // Never persisted anywhere (docs/14-statement-upload.md).
  const [password, setPassword] = useState("");
  const [retryPassword, setRetryPassword] = useState("");
  const [retrying, setRetrying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!loading && !accessToken) router.replace("/login");
  }, [loading, accessToken, router]);

  const refreshList = useCallback(async () => {
    if (!accessToken) return;
    setStatements(await statementsApi.list(accessToken));
  }, [accessToken]);

  useEffect(() => {
    if (accessToken) void refreshList();
  }, [accessToken, refreshList]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  function pollStatement(statementId: string) {
    stopPolling();
    pollRef.current = setInterval(async () => {
      if (!accessToken) return;
      const result = await statementsApi.get(accessToken, statementId);
      setActive(result);
      const jobDone = result.job?.completedAt || result.statement.status === "failed";
      if (jobDone) {
        stopPolling();
        void refreshList();
        if (result.statement.status !== "failed") {
          setActiveTransactions(await statementsApi.listTransactions(accessToken, statementId));
        }
      }
    }, POLL_INTERVAL_MS);
  }

  async function viewStatement(statementId: string) {
    if (!accessToken) return;
    stopPolling();
    setUploadError(null);
    const result = await statementsApi.get(accessToken, statementId);
    setActive(result);
    setActiveTransactions(
      result.statement.status === "failed" ? null : await statementsApi.listTransactions(accessToken, statementId),
    );
  }

  async function onFileSelected() {
    const file = fileInputRef.current?.files?.[0];
    if (!file || !accessToken) return;

    setUploadError(null);
    setUploading(true);
    setActive(null);
    setActiveTransactions(null);
    try {
      const { statementId, uploadUrl } = await statementsApi.requestUploadUrl(accessToken, {
        filename: file.name,
        contentType: "application/pdf",
        sizeBytes: file.size,
      });
      await statementsApi.uploadToStorage(uploadUrl, file);
      const confirmed = await statementsApi.confirm(accessToken, statementId, password ? { password } : {});
      setPassword("");
      setActive(confirmed);
      pollStatement(statementId);
    } catch (err) {
      setUploadError(
        err instanceof ApiError
          ? err.message
          : "We couldn't finish analyzing this statement. Try uploading it again.",
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  /** For a statement that failed with password_required/password_incorrect:
   * supply the password and re-run processing on the already-uploaded file
   * — no re-upload needed. */
  async function retryWithPassword() {
    if (!accessToken || !active || !retryPassword) return;
    setRetrying(true);
    setUploadError(null);
    try {
      const result = await statementsApi.reprocess(accessToken, active.statement.id, { password: retryPassword });
      setRetryPassword("");
      setActive(result);
      setActiveTransactions(null);
      pollStatement(active.statement.id);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "We couldn't retry this statement. Please try again.");
    } finally {
      setRetrying(false);
    }
  }

  const needsPassword =
    active?.statement.status === "failed" &&
    (active.job?.errorCode === "password_required" || active.job?.errorCode === "password_incorrect");

  if (loading || !accessToken) {
    return (
      <AppShell brand="M-Pesa Financial Intelligence">
        <Spinner />
      </AppShell>
    );
  }

  return (
    <AppShell
      brand="M-Pesa Financial Intelligence"
      nav={<AppNav />}
      side={
        <>
          <span style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>{user?.email}</span>
          <Button variant="ghost" size="sm" onClick={() => logout().then(() => router.push("/login"))}>
            Log out
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 640, margin: "0 auto" }}>
        {user && !user.emailVerified ? (
          <Alert tone="warning" title="Please verify your email" description="Check your inbox for a verification link." />
        ) : null}

        <Card>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Upload your M-Pesa statement</h1>
            <p style={{ margin: 0, color: "var(--color-text-secondary)" }}>PDF, up to 25MB.</p>
            <Input
              label="Statement password (if the PDF is protected)"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={uploading}
              helperText="The M-Pesa app emails a protected PDF and sends its password by SMS. We use it once to read the file and never store it."
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              disabled={uploading}
              onChange={onFileSelected}
            />
            {uploadError ? <Alert tone="danger" title={uploadError} /> : null}
          </div>
        </Card>

        {active ? (
          <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong>{active.statement.originalFilename}</strong>
                <Badge tone={active.statement.status === "failed" ? "danger" : "primary"}>
                  {active.statement.status}
                </Badge>
              </div>
              {active.job ? (
                <ProcessingSteps
                  currentStage={active.job.stage}
                  failed={active.statement.status === "failed"}
                />
              ) : null}
              {active.statement.status === "failed" ? (
                <Alert tone="danger" {...failureMessageFor(active.job?.errorCode)} />
              ) : null}
              {needsPassword ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void retryWithPassword();
                  }}
                  style={{ display: "flex", flexDirection: "column", gap: 12 }}
                >
                  <Input
                    label="Statement password"
                    type="password"
                    autoComplete="off"
                    value={retryPassword}
                    onChange={(e) => setRetryPassword(e.target.value)}
                    disabled={retrying}
                    helperText="From the SMS M-Pesa sent with this statement. Used once, never stored."
                  />
                  <div>
                    <Button type="submit" loading={retrying} disabled={!retryPassword}>
                      Unlock and try again
                    </Button>
                  </div>
                </form>
              ) : null}
              {active.statement.status === "needs_review" ? (
                <Alert
                  tone="warning"
                  title="We noticed something unusual in this statement"
                  description="Some rows didn't extract cleanly or the running balance didn't add up. The transactions below are still shown for review."
                />
              ) : null}
            </div>
          </Card>
        ) : null}

        {activeTransactions ? (
          <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <strong>{activeTransactions.length} transaction{activeTransactions.length === 1 ? "" : "s"} found</strong>
              {activeTransactions.length === 0 ? (
                <EmptyState title="No transactions extracted" />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th>Type</th>
                      <th className={tableStyles.numeric}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeTransactions.map((t) => (
                      <tr key={t.id}>
                        <td>{new Date(t.transactionDate).toLocaleDateString()}</td>
                        <td>
                          {t.merchantName ?? t.description}
                          {t.isDuplicate ? (
                            <Badge tone="warning" style={{ marginLeft: 8 }}>
                              possible duplicate
                            </Badge>
                          ) : null}
                        </td>
                        <td>{t.transactionType.replaceAll("_", " ")}</td>
                        <td className={tableStyles.numeric} style={{ color: t.direction === "credit" ? "var(--color-money-positive)" : "var(--color-money-neutral)" }}>
                          {t.direction === "credit" ? "+" : "-"}KSh {t.amount.amount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          </Card>
        ) : null}

        <section>
          <h2 style={{ fontSize: "1rem" }}>Your statements</h2>
          {statements === null ? (
            <Spinner />
          ) : statements.length === 0 ? (
            <Card>
              <EmptyState
                title="No statement analyzed yet"
                description="Upload your first statement above to see it here."
              />
            </Card>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {statements.map((s) => (
                <Card
                  key={s.id}
                  padding="sm"
                  interactive
                  onClick={() => viewStatement(s.id)}
                  style={{ cursor: "pointer" }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>
                      {s.originalFilename}
                      {s.transactionCount > 0 ? (
                        <span style={{ color: "var(--color-text-secondary)", fontSize: "0.8125rem" }}>
                          {" "}
                          — {s.transactionCount} transaction{s.transactionCount === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </span>
                    <Badge tone={s.status === "failed" ? "danger" : s.status === "needs_review" ? "warning" : "neutral"}>
                      {s.status}
                    </Badge>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
