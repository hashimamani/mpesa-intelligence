# Placeholder — not a working configuration yet. Populated at Stage 15
# (docs/09-testing-deployment-strategy.md) once an AWS account and remote
# Terraform state backend exist. See infrastructure/README.md.

terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # backend "s3" {
  #   # Filled in once a real AWS account + state bucket exist.
  # }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  description = "AWS region for the production environment"
  type        = string
  default     = "eu-west-1"
}

# modules (vpc, database, compute, storage, queues, secrets, monitoring) are
# added here once infrastructure/terraform/modules/* exist. Intentionally
# empty otherwise — no fake/simulated resources.
