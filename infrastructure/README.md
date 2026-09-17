# Infrastructure

Terraform-managed AWS infrastructure, per [docs/03-architecture.md](../docs/03-architecture.md).

## Status: not yet provisioned

No AWS account exists in this workspace (see
[docs/10-risks-and-decisions.md](../docs/10-risks-and-decisions.md)). The
directories here are the intended structure for Stage 15 — they contain
placeholder Terraform files, not real modules, and `terraform apply` is not
expected to succeed against them yet. Building out real modules (VPC, RDS/
Aurora, ECS/Fargate, S3, SQS, CloudFront, Secrets Manager, IAM) happens once:

1. An AWS account and org structure exist.
2. IAM is set up for Terraform to run with least-privilege credentials
   (never a root account key).
3. Remote state (S3 backend + DynamoDB lock table, or Terraform Cloud) is
   decided and configured — state is never local-only for anything beyond a
   throwaway experiment.

## Structure

```
environments/
  development/   # local docker-compose covers this instead — see root docker-compose.yml
  staging/
  production/
modules/          # shared Terraform modules (vpc, database, compute, storage, ...)
```

`development` has no Terraform-managed resources — local development runs
entirely via `docker-compose.yml` at the repo root. The `environments/
development` directory exists only for structural symmetry and is expected
to stay empty of real resources.
