# Security Threat Model & Privacy

## Scope

This is a threat model for a system handling highly sensitive financial
documents (M-Pesa statements) and derived personal financial data, for both
individual and multi-tenant business users.

## Threats and mitigations

| Threat | Mitigation |
|---|---|
| Account takeover | Strong password policy, rate-limited login, brute-force lockout, session/device management, email-verified accounts, OTP for sensitive actions (planned), token rotation on refresh. |
| Malicious PDF upload (malware, decompression bombs, exploit payloads) | File type/size validation before processing, processing runs in an isolated worker (no shell-out to untrusted binaries against the raw file), malware scanning on upload where feasible (e.g. ClamAV in the ingestion path), strict parser library choice reviewed for known CVEs. |
| Prompt injection via statement text (e.g. a transaction description reading "ignore previous instructions...") | AI never receives raw document text as an instruction channel — only structured, verified analytics are passed to the AI, with document-derived strings passed strictly as quoted data, never concatenated into the system/instruction prompt. Full detail in [07-ai-architecture.md](07-ai-architecture.md) §Prompt injection defense. |
| Unauthorized statement/transaction access (IDOR) | Every resource fetch is scoped through the authenticated owner context (see [04-database-erd.md](04-database-erd.md) §Tenant isolation enforcement); resource IDs are UUIDs, not sequential, as defense-in-depth, not as the primary control. |
| Cross-tenant data leakage | Mandatory tenant-scoped queries at the repository layer; dedicated negative tests attempting cross-org access before every release touching auth/data access. |
| SQL injection | Parameterized queries via the ORM/query builder exclusively; no raw string-concatenated SQL. |
| XSS | React's default escaping, CSP headers, no `dangerouslySetInnerHTML` on any user- or document-derived content. |
| CSRF | SameSite cookies for session-bearing requests; state-changing API routes require a valid auth token, not cookie presence alone. |
| API abuse / scraping / brute force | Per-user and per-IP rate limiting at the ALB/WAF and application layer, especially on auth and upload endpoints. |
| Leaked S3 signed URLs | Short expiry (minutes, not hours), scoped to a single object, bucket otherwise fully private with no public ACLs. |
| Compromised admin account | Admin access requires a separate elevated auth flow (MFA required, not optional), every admin action is an `AuditEvent`, admin UI never surfaces full transaction descriptions/statement content beyond what's needed to debug a job. |
| Dependency/supply-chain vulnerabilities | Automated dependency scanning in CI (e.g. `npm audit`/Dependabot/Snyk-class tool), pinned lockfiles, review before upgrading anything with install-time scripts. |
| Secrets in logs or code | Centralized config validated at startup (see 03, environment variables); structured logging with an explicit redaction list for PII/financial fields; no secret ever in a committed file — `.env.example` only. |

## Data minimization principles

- Never log full transaction descriptions, full statement contents,
  credentials, tokens, or secrets. Structured logs carry IDs and enums, not
  raw financial text, except at DEBUG level in non-production environments.
- Phone numbers used as counterparty identifiers are hashed at rest where
  they aren't needed in display form; raw phone numbers are never sent to the
  AI provider (see 07 §Data minimization for AI calls).
- Uploaded statement objects in S3 are retained only per the configured
  retention policy; a user-initiated statement deletion revokes access,
  deletes the S3 object, and soft-deletes/purges derived records per the
  documented retention window (see §Data retention below).

## Data retention

- Default retention for a raw statement object: configurable, defaults
  proposed at 24 months or until the user deletes the statement, whichever
  is sooner — **this default needs product/legal sign-off**, not an
  engineering default (flagged in risks doc).
- On user-initiated deletion: S3 object deleted, `Statement` and
  `Transaction` rows soft-deleted immediately (excluded from all reads),
  hard-purged by a scheduled job after a short grace window (default
  proposed: 30 days, to allow accidental-deletion recovery).
- `AuditEvent` records are retained independently of the data they reference,
  per standard audit-log retention practice, and contain no raw financial
  content — only actor, action, resource type/id, and timestamp.

## Privacy commitments (product-facing)

Users can see and control: what's stored, why, how long, and how to delete
it. Financial transaction data is never used to train AI/ML models without a
separate, explicit legal basis, disclosure, and opt-in — none of which exist
yet, so **no user data is used for model training in V1**, full stop.

## Compliance checklist (status: not started — flagged as a launch blocker)

- [ ] Kenya Data Protection Act (2019) compliance review
- [ ] Privacy policy drafted and reviewed by counsel
- [ ] Terms of service drafted and reviewed by counsel
- [ ] Data Protection Impact Assessment for financial data processing
- [ ] Data processing agreements with third-party processors (AI provider,
      billing provider, cloud provider)
- [ ] Registration with the Office of the Data Protection Commissioner (ODPC),
      if applicable to this product's scale/activity
- [ ] Consumer protection review for subscription billing terms (auto-renewal
      disclosures, cancellation rights)

**This checklist is not satisfied by any engineering work in this repository.
It requires an actual lawyer. See [10-risks-and-decisions.md](10-risks-and-decisions.md), item D-2.**

## Security testing plan (executed at Stage 16, not now)

Dependency vulnerability scanning (continuous, in CI), static analysis
(continuous, in CI), API authorization testing, tenant isolation testing,
file upload security testing (malicious PDFs, oversized files, wrong MIME
types), authentication testing (brute force, session fixation, token
replay). A third-party security review is recommended before handling real
user statements at scale — flagged as a decision item, not committed to a
budget or vendor yet.
