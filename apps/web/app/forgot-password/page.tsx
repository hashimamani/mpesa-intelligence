"use client";

import { useState, type FormEvent } from "react";
import { AppShell, Alert, Button, Card, Input } from "@mpesa/ui";
import { authApi } from "../../lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      // Always the same UI outcome whether or not the account exists — the
      // API itself never reveals that either (docs/13-auth-architecture.md).
      await authApi.forgotPassword(email);
    } finally {
      setSubmitting(false);
      setDone(true);
    }
  }

  return (
    <AppShell brand="M-Pesa Financial Intelligence">
      <Card style={{ maxWidth: 400, margin: "0 auto" }}>
        {done ? (
          <Alert
            tone="info"
            title="Check your email"
            description="If an account exists for that email, we've sent a link to reset your password."
          />
        ) : (
          <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Reset your password</h1>
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Button type="submit" loading={submitting} fullWidth>
              Send reset link
            </Button>
          </form>
        )}
      </Card>
    </AppShell>
  );
}
