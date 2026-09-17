"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { AppShell, Alert, Button, Card, Input } from "@mpesa/ui";
import { useAuth } from "../../lib/auth-context";
import { ApiError } from "../../lib/api";

export default function RegisterPage() {
  const { register } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register(email, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell brand="M-Pesa Financial Intelligence" side={<Link href="/login">Log in</Link>}>
      <Card style={{ maxWidth: 400, margin: "0 auto" }}>
        {done ? (
          <Alert
            tone="success"
            title="Check your email"
            description={`We sent a verification link to ${email}. Verify it, then log in.`}
          />
        ) : (
          <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Create your account</h1>
            {error ? <Alert tone="danger" title={error} /> : null}
            <Input
              label="Email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              label="Password"
              type="password"
              autoComplete="new-password"
              required
              helperText="At least 10 characters, one uppercase letter, one number"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button type="submit" loading={submitting} fullWidth>
              Create account
            </Button>
          </form>
        )}
      </Card>
    </AppShell>
  );
}
