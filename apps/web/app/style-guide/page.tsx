"use client";

import { useState } from "react";
import {
  Alert,
  AppShell,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  ProcessingSteps,
  Skeleton,
  Spinner,
  Table,
  color,
  spacing,
  tableStyles,
} from "@mpesa/ui";

// Internal reference page for the design system built at Stage 3 — not a
// product screen. Renders every primitive together so changes to tokens.css
// or a component are visible in one place. Not linked from product nav.

const section: React.CSSProperties = { display: "flex", flexDirection: "column", gap: spacing["2xl"] };
const row: React.CSSProperties = { display: "flex", gap: spacing.lg, flexWrap: "wrap", alignItems: "center" };
const swatchRow: React.CSSProperties = { display: "flex", gap: spacing.sm, flexWrap: "wrap" };

function Swatch({ hex, label }: { hex: string; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, width: 88 }}>
      <div style={{ height: 40, borderRadius: 8, background: hex, border: "1px solid rgba(0,0,0,0.06)" }} />
      <span style={{ fontSize: 11, color: "var(--color-text-secondary)" }}>{label}</span>
    </div>
  );
}

export default function StyleGuidePage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  return (
    <AppShell
      brand="M-Pesa Intelligence — Design System"
      nav={<span>Style Guide</span>}
      side={<Badge tone="primary">Stage 3</Badge>}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: spacing["4xl"] }}>
        <section style={section}>
          <h2>Color</h2>
          <div style={swatchRow}>
            {Object.entries(color.primary).map(([k, v]) => (
              <Swatch key={k} hex={v} label={`primary.${k}`} />
            ))}
          </div>
          <div style={swatchRow}>
            {Object.entries(color.neutral).map(([k, v]) => (
              <Swatch key={k} hex={v} label={`neutral.${k}`} />
            ))}
          </div>
          <div style={swatchRow}>
            <Swatch hex={color.semantic.success} label="success" />
            <Swatch hex={color.semantic.danger} label="danger" />
            <Swatch hex={color.semantic.warning} label="warning" />
            <Swatch hex={color.semantic.info} label="info" />
          </div>
        </section>

        <section style={section}>
          <h2>Typography</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
            <span style={{ fontSize: "2.5rem", fontWeight: 700 }}>Display — Where your money went</span>
            <h1>H1 — Financial snapshot</h1>
            <h2>H2 — Biggest categories</h2>
            <h3>H3 — Transport</h3>
            <p style={{ fontSize: "1rem" }}>Body — Food spending increased by about 36% compared with the previous period.</p>
            <span style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
              Body small — based on 214 transactions from your August statement.
            </span>
          </div>
        </section>

        <section style={section}>
          <h2>Buttons</h2>
          <div style={row}>
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
            <Button variant="primary" loading={loading} onClick={() => setLoading((v) => !v)}>
              {loading ? "Uploading…" : "Toggle loading"}
            </Button>
          </div>
          <div style={row}>
            <Button size="sm">Small</Button>
            <Button size="md">Medium</Button>
            <Button size="lg">Large</Button>
          </div>
        </section>

        <section style={section}>
          <h2>Inputs</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: spacing.lg, maxWidth: 360 }}>
            <Input label="Email" type="email" placeholder="you@example.com" />
            <Input label="Savings goal name" helperText="e.g. Emergency fund" />
            <Input label="Target amount" errorText="Must be a valid decimal amount" defaultValue="12,000" />
          </div>
        </section>

        <section style={section}>
          <h2>Badges</h2>
          <div style={row}>
            <Badge tone="neutral">Free</Badge>
            <Badge tone="primary">Premium</Badge>
            <Badge tone="success">Processed</Badge>
            <Badge tone="warning">Needs review</Badge>
            <Badge tone="danger">Failed</Badge>
          </div>
        </section>

        <section style={section}>
          <h2>Alerts</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: spacing.md }}>
            <Alert tone="info" title="Your statement is being analyzed" description="This usually takes under a minute." />
            <Alert tone="success" title="You reduced shopping spending by 18%" description="Compared with last month." />
            <Alert tone="warning" title="We noticed something unusual" description="A transaction on Aug 14 was much larger than your usual pattern." />
            <Alert tone="danger" title="We couldn't finish analyzing this statement" description="Try uploading it again, or contact support." />
          </div>
        </section>

        <section style={section}>
          <h2>Cards</h2>
          <div style={row}>
            <Card style={{ width: 240 }}>
              <strong>Total spent</strong>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: 4 }}>KSh 42,180</div>
            </Card>
            <Card interactive style={{ width: 240 }}>
              <strong>Transport</strong>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, marginTop: 4, color: "var(--color-money-neutral)" }}>
                KSh 8,400
              </div>
            </Card>
          </div>
        </section>

        <section style={section}>
          <h2>Table</h2>
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
              <tr>
                <td>Aug 14</td>
                <td>Java House</td>
                <td>Food · Restaurants</td>
                <td className={tableStyles.numeric}>KSh 1,250.00</td>
              </tr>
              <tr>
                <td>Aug 13</td>
                <td>Uber</td>
                <td>Transport</td>
                <td className={tableStyles.numeric}>KSh 540.00</td>
              </tr>
            </tbody>
          </Table>
        </section>

        <section style={section}>
          <h2>Loading &amp; empty states</h2>
          <div style={row}>
            <Spinner size="sm" />
            <Spinner size="md" />
            <Spinner size="lg" />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: spacing.sm, maxWidth: 320 }}>
            <Skeleton height={14} width="80%" />
            <Skeleton height={14} width="60%" />
            <Skeleton height={14} width="70%" />
          </div>
          <Card>
            <EmptyState
              title="No statement analyzed yet"
              description="Upload your first statement to see your spending breakdown."
              action={<Button>Upload a statement</Button>}
            />
          </Card>
        </section>

        <section style={section}>
          <h2>Statement processing steps</h2>
          <Card style={{ maxWidth: 320 }}>
            <ProcessingSteps currentStage="categorizing" />
          </Card>
        </section>

        <section style={section}>
          <h2>Dialog</h2>
          <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
          <Dialog open={dialogOpen} title="Delete this statement?" onClose={() => setDialogOpen(false)}>
            This removes the statement and its transactions. This can&apos;t be undone.
            <div style={{ display: "flex", gap: spacing.md, marginTop: spacing.lg }}>
              <Button variant="danger" onClick={() => setDialogOpen(false)}>
                Delete
              </Button>
              <Button variant="secondary" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
            </div>
          </Dialog>
        </section>
      </div>
    </AppShell>
  );
}
