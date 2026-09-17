"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AppShell, Alert, Button, Card, Spinner } from "@mpesa/ui";
import { authApi } from "../../lib/api";

type Status = "verifying" | "success" | "error";

// useSearchParams() opts a page into dynamic rendering unless wrapped in
// Suspense — Next.js errors on this at build time otherwise.
export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const token = useSearchParams().get("token");
  const [status, setStatus] = useState<Status>("verifying");
  // The verification token is single-use — React 18 StrictMode intentionally
  // double-invokes effects in development to surface exactly this kind of
  // bug (found via the browser: the second, duplicate call correctly got
  // rejected with 401 since the token was already consumed, and its result
  // raced the first call's success). This ref makes the actual network call
  // fire once regardless of how many times the effect body runs.
  const requestedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      return;
    }
    if (requestedRef.current === token) return;
    requestedRef.current = token;

    authApi
      .verifyEmail(token)
      .then(() => setStatus("success"))
      .catch(() => setStatus("error"));
  }, [token]);

  return (
    <AppShell brand="M-Pesa Financial Intelligence">
      <Card style={{ maxWidth: 400, margin: "0 auto", textAlign: "center" }}>
        {status === "verifying" ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <Spinner />
            <span>Verifying your email…</span>
          </div>
        ) : status === "success" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Alert tone="success" title="Email verified" description="You can now log in." />
            <Link href="/login">
              <Button fullWidth>Log in</Button>
            </Link>
          </div>
        ) : (
          <Alert
            tone="danger"
            title="This verification link is invalid or has expired"
            description="Log in and request a new one, or contact support."
          />
        )}
      </Card>
    </AppShell>
  );
}
