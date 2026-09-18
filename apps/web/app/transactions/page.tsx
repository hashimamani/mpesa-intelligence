"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CategoryDTO, TransactionDTO } from "@mpesa/types";
import { AppShell, Badge, Card, EmptyState, Select, Spinner, Table, tableStyles } from "@mpesa/ui";
import { useAuth } from "../../lib/auth-context";
import { ApiError, categoriesApi, transactionsApi } from "../../lib/api";
import { AppNav } from "../../lib/nav";
import { formatMoney } from "../../lib/format";

/**
 * "Transaction list with manual category correction" — docs/01-prd.md's
 * MVP feature list, docs/06 layer 5. Lists every transaction across every
 * statement for one month (defaults to the same "most recent active month"
 * the dashboard uses — see docs/17-analytics-engine.md), each row's
 * category correctable inline via a Select grouped by top-level category.
 */
export default function TransactionsPage() {
  const { user, accessToken, loading, logout } = useAuth();
  const router = useRouter();

  const [transactions, setTransactions] = useState<TransactionDTO[] | null>(null);
  const [categories, setCategories] = useState<CategoryDTO[] | null>(null);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !accessToken) router.replace("/login");
  }, [loading, accessToken, router]);

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    Promise.all([transactionsApi.listForMonth(accessToken), categoriesApi.list(accessToken)])
      .then(([tx, cats]) => {
        if (cancelled) return;
        setTransactions(tx);
        setCategories(cats);
      })
      .catch(() => {
        if (!cancelled) setError("We couldn't load your transactions right now. Try refreshing.");
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  async function onCorrect(transactionId: string, categoryId: string) {
    if (!accessToken || !categoryId) return;
    setCorrectingId(transactionId);
    setError(null);
    try {
      const updated = await transactionsApi.correctCategory(accessToken, { transactionId, categoryId });
      setTransactions((prev) => prev?.map((t) => (t.id === transactionId ? updated : t)) ?? prev);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't save that category. Try again.");
    } finally {
      setCorrectingId(null);
    }
  }

  if (loading || !accessToken) {
    return (
      <AppShell brand="M-Pesa Financial Intelligence">
        <Spinner />
      </AppShell>
    );
  }

  const topLevelCategories = categories?.filter((c) => c.parentId === null) ?? [];
  const childrenOf = (parentId: string) => categories?.filter((c) => c.parentId === parentId) ?? [];

  return (
    <AppShell
      brand="M-Pesa Financial Intelligence"
      nav={<AppNav />}
      side={
        <>
          <span style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>{user?.email}</span>
          <button
            onClick={() => logout().then(() => router.push("/login"))}
            style={{ background: "none", border: "none", color: "var(--color-text-secondary)", cursor: "pointer", fontSize: "0.875rem" }}
          >
            Log out
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 960, margin: "0 auto" }}>
        <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Transactions</h1>

        {error ? (
          <Card>
            <EmptyState title="Something went wrong" description={error} />
          </Card>
        ) : null}

        {transactions === null || categories === null ? (
          <Spinner />
        ) : transactions.length === 0 ? (
          <Card>
            <EmptyState title="No transactions this period" description="Upload a statement to see transactions here." />
          </Card>
        ) : (
          <Card padding="sm">
            <Table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Category</th>
                  <th className={tableStyles.numeric}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((t) => {
                  const selectedCategoryId = t.subcategoryId ?? t.categoryId ?? "";
                  return (
                    <tr key={t.id}>
                      <td>{new Date(t.transactionDate).toLocaleDateString()}</td>
                      <td>
                        {t.merchantName ?? t.description}
                        {t.isDuplicate ? (
                          <Badge tone="warning" style={{ marginLeft: 8 }}>
                            possible duplicate
                          </Badge>
                        ) : null}
                        {t.classificationSource === "user_correction" ? (
                          <Badge tone="neutral" style={{ marginLeft: 8 }}>
                            corrected
                          </Badge>
                        ) : null}
                      </td>
                      <td style={{ minWidth: 220 }}>
                        <Select
                          label={`Category for ${t.merchantName ?? t.description}`}
                          hideLabel
                          value={selectedCategoryId}
                          disabled={correctingId === t.id}
                          onChange={(e) => onCorrect(t.id, e.target.value)}
                        >
                          {selectedCategoryId === "" ? <option value="">Uncategorized</option> : null}
                          {topLevelCategories.map((top) => {
                            const children = childrenOf(top.id);
                            if (children.length === 0) {
                              return (
                                <option key={top.id} value={top.id}>
                                  {top.name}
                                </option>
                              );
                            }
                            return (
                              <optgroup key={top.id} label={top.name}>
                                {children.map((child) => (
                                  <option key={child.id} value={child.id}>
                                    {child.name}
                                  </option>
                                ))}
                              </optgroup>
                            );
                          })}
                        </Select>
                      </td>
                      <td
                        className={tableStyles.numeric}
                        style={{ color: t.direction === "credit" ? "var(--color-money-positive)" : "var(--color-money-neutral)" }}
                      >
                        {t.direction === "credit" ? "+" : "-"}
                        {formatMoney(t.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
