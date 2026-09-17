"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppShell, Button, Spinner } from "@mpesa/ui";
import { useAuth } from "../lib/auth-context";

// Real onboarding per docs/02-user-journeys.md (J1): one action, no
// questionnaire. Logged-in visitors go straight to /upload instead of
// seeing this again.
export default function HomePage() {
  const { accessToken, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && accessToken) router.replace("/upload");
  }, [loading, accessToken, router]);

  if (loading || accessToken) {
    return (
      <AppShell brand="M-Pesa Financial Intelligence">
        <Spinner />
      </AppShell>
    );
  }

  return (
    <AppShell brand="M-Pesa Financial Intelligence" side={<Link href="/login">Log in</Link>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 480 }}>
        <h1>Upload your M-Pesa statement and we&apos;ll show you where your money went.</h1>
        <Link href="/register">
          <Button size="lg">Get started</Button>
        </Link>
      </div>
    </AppShell>
  );
}
