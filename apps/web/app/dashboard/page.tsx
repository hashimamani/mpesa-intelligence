"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SpendingSummaryDTO, StatementDTO } from "@mpesa/types";
import { AppShell, BarList, Button, Card, EmptyState, Spinner, StatTile, TrendChart } from "@mpesa/ui";
import { useAuth } from "../../lib/auth-context";
import { analyticsApi, statementsApi } from "../../lib/api";
import { AppNav } from "../../lib/nav";
import { formatMonthLabel, formatMonthShort, formatMoney } from "../../lib/format";

/**
 * The consumer dashboard (docs/01-prd.md MVP, docs/02's "aha moment"):
 * financial snapshot, "where your money went" breakdown, spending trend,
 * top merchants. The empty state ("Upload your M-Pesa statement and we'll
 * show you where your money went") lives here now, not on `/upload` — a
 * first-time user should land on the same screen that will later show
 * their real numbers (J1 step 2).
 */
export default function DashboardPage() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();

  const [statements, setStatements] = useState<StatementDTO[] | null>(null);
  const [summary, setSummary] = useState<SpendingSummaryDTO | null>(null);
  const [trend, setTrend] = useState<SpendingSummaryDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !accessToken) router.replace("/login");
  }, [loading, accessToken, router]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setError(null);
    statementsApi
      .list(accessToken)
      .then(async (list) => {
        if (cancelled) return;
        setStatements(list);
        if (list.length === 0) return; // genuinely nothing to summarize yet
        const [summaryRes, trendRes] = await Promise.all([
          analyticsApi.summary(accessToken),
          analyticsApi.trend(accessToken, 6),
        ]);
        if (cancelled) return;
        setSummary(summaryRes);
        setTrend(trendRes);
      })
      .catch(() => {
        if (!cancelled) setError("We couldn't load your dashboard right now. Try refreshing.");
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  if (loading || !accessToken) {
    return (
      <AppShell brand="M-Pesa Financial Intelligence">
        <Spinner />
      </AppShell>
    );
  }

  const netMovementIsNegative = summary ? Number(summary.netMovement.amount) < 0 : false;

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
      <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 960, margin: "0 auto" }}>
        {error ? <Card><EmptyState title="Something went wrong" description={error} /></Card> : null}

        {statements === null ? (
          <Spinner />
        ) : statements.length === 0 ? (
          <Card>
            <EmptyState
              title="Upload your M-Pesa statement and we'll show you where your money went"
              description="One PDF is all it takes — we'll extract, categorize, and total everything automatically."
              action={
                <Link href="/upload">
                  <Button size="lg">Upload your first statement</Button>
                </Link>
              }
            />
          </Card>
        ) : !summary || !trend ? (
          <Spinner />
        ) : (
          <>
            <div>
              <h1 style={{ margin: 0, fontSize: "1.25rem" }}>{formatMonthLabel(summary.periodStart)}</h1>
              <p style={{ margin: "4px 0 0", color: "var(--color-text-secondary)", fontSize: "0.875rem" }}>
                Your financial snapshot for this period.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
              <StatTile label="Received" value={formatMoney(summary.totalReceived)} tone="positive" />
              <StatTile label="Spent" value={formatMoney(summary.totalSpent)} tone="neutral" />
              <StatTile label="Fees" value={formatMoney(summary.totalFees)} tone="neutral" />
              <StatTile
                label="Net movement"
                value={formatMoney(summary.netMovement)}
                tone={netMovementIsNegative ? "negative" : "positive"}
                caption="Every debit, not just spending"
              />
            </div>

            <Card>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: "1rem" }}>Where your money went</h2>
                  <p style={{ margin: "2px 0 0", color: "var(--color-text-secondary)", fontSize: "0.8125rem" }}>
                    Real spending only — transfers, cash, and savings aren&apos;t counted here.
                  </p>
                </div>
                {summary.byCategory.length === 0 ? (
                  <EmptyState title="No spending recorded this period" description="Transfers and withdrawals don't count as spending — see the snapshot above for those." />
                ) : (
                  <BarList
                    tone="neutral"
                    items={summary.byCategory.map((c) => ({
                      id: c.categoryId,
                      label: c.categoryName,
                      value: Number(c.total.amount),
                      displayValue: formatMoney(c.total),
                    }))}
                  />
                )}
              </div>
            </Card>

            <Card>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <h2 style={{ margin: 0, fontSize: "1rem" }}>Spending trend</h2>
                <TrendChart
                  points={trend.map((t) => ({
                    id: t.periodStart,
                    monthLabel: formatMonthShort(t.periodStart),
                    value: Number(t.totalSpent.amount),
                    displayValue: formatMoney(t.totalSpent),
                    isCurrent: t.periodStart === summary.periodStart,
                  }))}
                />
              </div>
            </Card>

            <Card>
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <h2 style={{ margin: 0, fontSize: "1rem" }}>Top merchants</h2>
                {summary.topMerchants.length === 0 ? (
                  <EmptyState title="No merchant spending recorded this period" />
                ) : (
                  <BarList
                    tone="primary"
                    items={summary.topMerchants.map((m) => ({
                      id: m.merchantName,
                      label: m.merchantName,
                      value: Number(m.total.amount),
                      displayValue: formatMoney(m.total),
                      meta: `${m.transactionCount} transaction${m.transactionCount === 1 ? "" : "s"}`,
                    }))}
                  />
                )}
              </div>
            </Card>

            <div>
              <Link href="/transactions">
                <Button variant="secondary">View all transactions</Button>
              </Link>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
