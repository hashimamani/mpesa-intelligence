"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { StatementDTO, StatementWithJobDTO } from "@mpesa/types";
import { AppShell, Alert, Badge, Button, Card, EmptyState, ProcessingSteps, Spinner } from "@mpesa/ui";
import { useAuth } from "../../lib/auth-context";
import { ApiError, statementsApi } from "../../lib/api";

const POLL_INTERVAL_MS = 1500;

export default function UploadPage() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();

  const [statements, setStatements] = useState<StatementDTO[] | null>(null);
  const [active, setActive] = useState<StatementWithJobDTO | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
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
      }
    }, POLL_INTERVAL_MS);
  }

  async function onFileSelected() {
    const file = fileInputRef.current?.files?.[0];
    if (!file || !accessToken) return;

    setUploadError(null);
    setUploading(true);
    setActive(null);
    try {
      const { statementId, uploadUrl } = await statementsApi.requestUploadUrl(accessToken, {
        filename: file.name,
        contentType: "application/pdf",
        sizeBytes: file.size,
      });
      await statementsApi.uploadToStorage(uploadUrl, file);
      const confirmed = await statementsApi.confirm(accessToken, statementId);
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
                <Alert
                  tone="danger"
                  title="We couldn't finish analyzing this statement"
                  description="Try uploading it again, or contact support."
                />
              ) : null}
              {active.statement.pageCount ? (
                <span style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
                  Confirmed readable — {active.statement.pageCount} page
                  {active.statement.pageCount === 1 ? "" : "s"}. Full extraction and analytics are built in a later
                  stage.
                </span>
              ) : null}
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
                <Card key={s.id} padding="sm">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>{s.originalFilename}</span>
                    <Badge tone={s.status === "failed" ? "danger" : "neutral"}>{s.status}</Badge>
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
