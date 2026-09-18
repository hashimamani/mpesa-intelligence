"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell, Alert, Button, Card, Input } from "@mpesa/ui";
import { useAuth } from "../../lib/auth-context";
import { ApiError } from "../../lib/api";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell brand="M-Pesa Financial Intelligence" side={<Link href="/register">Sign up</Link>}>
      <Card style={{ maxWidth: 400, margin: "0 auto" }}>
        <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Log in</h1>
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
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Button type="submit" loading={submitting} fullWidth>
            Log in
          </Button>
          <Link href="/forgot-password" style={{ fontSize: "0.875rem", textAlign: "center" }}>
            Forgot your password?
          </Link>
        </form>
      </Card>
    </AppShell>
  );
}
