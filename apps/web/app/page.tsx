import { AppShell, Button } from "@mpesa/ui";

// Still a placeholder — real onboarding UI (docs/02-user-journeys.md, J1) needs
// auth (Stage 4) and the upload flow (Stage 5). What's new at Stage 3 is that
// it's now built from the design system instead of unstyled markup.

export default function HomePage() {
  return (
    <AppShell brand="M-Pesa Financial Intelligence">
      <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 480 }}>
        <h1>Upload your M-Pesa statement and we&apos;ll show you where your money went.</h1>
        <Button size="lg" disabled>
          Upload a statement (coming in Stage 5)
        </Button>
      </div>
    </AppShell>
  );
}
