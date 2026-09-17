import { AppShell, EmptyState } from "@mpesa/ui";

// Scaffold only. Real admin capabilities (processing job visibility, failed-job
// inspection, subscription metrics, audit log viewer — see docs/01-prd.md V2 scope
// and docs/10-risks-and-decisions.md) are built at Stage 13, behind elevated
// MFA-gated auth per docs/05-security-threat-model.md.

export default function AdminHomePage() {
  return (
    <AppShell brand="M-Pesa Intelligence — Admin">
      <EmptyState
        title="Nothing to show yet"
        description="Admin capabilities are built at Stage 13, once there's real processing/subscription data to inspect."
      />
    </AppShell>
  );
}
