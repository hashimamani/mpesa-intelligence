// Scaffold only. Real admin capabilities (processing job visibility, failed-job
// inspection, subscription metrics, audit log viewer — see docs/01-prd.md V2 scope
// and the original spec §38/§92) are built at Stage 13, behind elevated MFA-gated
// auth per docs/05-security-threat-model.md.

export default function AdminHomePage() {
  return (
    <main>
      <h1>Admin</h1>
      <p>Not yet implemented — scaffolded at Stage 2, built out at Stage 13.</p>
    </main>
  );
}
