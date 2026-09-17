"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AppShell, Alert, Button, Card, Input } from "@mpesa/ui";
import { authApi, ApiError } from "../../lib/api";

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const token = useSearchParams().get("token");
  const [newPassword, setNewPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    setSubmitting(true);
    try {
      await authApi.resetPassword(token, newPassword);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell brand="M-Pesa Financial Intelligence">
      <Card style={{ maxWidth: 400, margin: "0 auto" }}>
        {!token ? (
          <Alert tone="danger" title="This reset link is missing its token" />
        ) : done ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Alert tone="success" title="Password updated" description="You can now log in with your new password." />
            <Link href="/login">
              <Button fullWidth>Log in</Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Choose a new password</h1>
            {error ? <Alert tone="danger" title={error} /> : null}
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              required
              helperText="At least 10 characters, one uppercase letter, one number"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <Button type="submit" loading={submitting} fullWidth>
              Update password
            </Button>
          </form>
        )}
      </Card>
    </AppShell>
  );
}
